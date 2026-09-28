import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAnalysisServiceUrl,
  fetchAnalysisService,
  resetAnalysisServiceIdTokenCache,
} from "@/infrastructure/analysisApi/analysisServiceClient.js";

/**
 * 這支測的是**每一個**對 analysis-ts 的出向呼叫都會經過的那個函式，所以它守的東西對 23 個 client 一起生效。
 *
 * 重點不是「fetch 有沒有被呼叫」，是三件會出事的事：
 *   1. 沒設 audience 時**完全不碰 metadata server**——本機打的是 localhost，那裡沒有 metadata server，
 *      若改成「總是嘗試」，每個本機請求都會先撞一個不存在的主機再等逾時。
 *   2. 拿不到 token 時**丟 502 而不是不帶 token 硬送**。後者會把一個明確的本地錯誤換成上游難解讀的 403，
 *      而且讓「以為有授權其實沒有」這種狀態靜默存在。
 *   3. token 有快取。ID token 一小時有效，每個請求都去換會多一次 metadata 往返。
 */
const ORIGINAL_FETCH = globalThis.fetch;
const METADATA_HOST = "metadata.google.internal";

beforeEach(() => {
  process.env.FILTERS_SERVICE_URL = "http://analysis.test";
  process.env.BFF_API_KEY = "test-key";
  delete process.env.ANALYSIS_SERVICE_AUDIENCE;
  resetAnalysisServiceIdTokenCache();
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  delete process.env.ANALYSIS_SERVICE_AUDIENCE;
});

/**
 * 依主機分流：metadata server 與 analysis-ts 是兩個不同的呼叫，測試要能分開觀察。
 *
 * 參數型別要寫全（含 init）——`vi.fn(async (input) => ...)` 會把參數推成長度 1 的 tuple，於是 tsc 眼裡
 * `mock.calls[0][1]` 不存在：測試照樣會綠，`npm run typecheck` 會紅。同一個陷阱在
 * resendEmailClient.test.ts 已經有註解，這裡第二次踩到。
 */
type FetchArgs = [input: URL | RequestInfo, init?: RequestInit];

function stubFetch(metadata: { ok: boolean; body?: string } | Error | undefined) {
  const mock = vi.fn(async (input: FetchArgs[0], _init?: FetchArgs[1]) => {
    const href = input instanceof URL ? input.href : String(input);
    if (href.includes(METADATA_HOST)) {
      if (metadata instanceof Error) throw metadata;
      if (!metadata) throw new Error("這個測試不預期會呼叫 metadata server");
      return { ok: metadata.ok, status: metadata.ok ? 200 : 500, text: async () => metadata.body ?? "" } as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as Response;
  });
  globalThis.fetch = mock as unknown as typeof fetch;
  return mock;
}

function headersOf(mock: ReturnType<typeof stubFetch>, host: string): Headers {
  const call = mock.mock.calls.find(([input]) => (input instanceof URL ? input.href : String(input)).includes(host));
  return new Headers((call?.[1] as RequestInit | undefined)?.headers);
}

describe("fetchAnalysisService", () => {
  it("沒設 audience 時不帶 Authorization，也完全不碰 metadata server", async () => {
    const mock = stubFetch(undefined);

    await fetchAnalysisService(buildAnalysisServiceUrl("/companies"));

    expect(mock.mock.calls.some(([input]) => (input instanceof URL ? input.href : String(input)).includes(METADATA_HOST))).toBe(false);
    const sent = headersOf(mock, "analysis.test");
    expect(sent.get("Authorization")).toBeNull();
    expect(sent.get("X-Api-Key")).toBe("test-key");
  });

  it("設了 audience 時帶上 ID token，而且 X-Api-Key 仍然在（兩層都送，不是二選一）", async () => {
    process.env.ANALYSIS_SERVICE_AUDIENCE = "https://analysis.run.app";
    const mock = stubFetch({ ok: true, body: "token-abc\n" });

    await fetchAnalysisService(buildAnalysisServiceUrl("/companies"));

    const metadataCall = mock.mock.calls.find(([input]) => (input instanceof URL ? input.href : String(input)).includes(METADATA_HOST));
    const metadataUrl = new URL(String(metadataCall?.[0]));
    expect(metadataUrl.searchParams.get("audience")).toBe("https://analysis.run.app");
    expect(headersOf(mock, METADATA_HOST).get("Metadata-Flavor")).toBe("Google");

    const sent = headersOf(mock, "analysis.test");
    // 尾端換行要被去掉：metadata server 回的是 text/plain，直接塞進標頭會變成一個無效的 header value。
    expect(sent.get("Authorization")).toBe("Bearer token-abc");
    expect(sent.get("X-Api-Key")).toBe("test-key");
  });

  it("token 有快取，第二次呼叫不再去 metadata server", async () => {
    process.env.ANALYSIS_SERVICE_AUDIENCE = "https://analysis.run.app";
    const mock = stubFetch({ ok: true, body: "token-abc" });

    await fetchAnalysisService(buildAnalysisServiceUrl("/a"));
    await fetchAnalysisService(buildAnalysisServiceUrl("/b"));

    const metadataCalls = mock.mock.calls.filter(([input]) => (input instanceof URL ? input.href : String(input)).includes(METADATA_HOST));
    expect(metadataCalls).toHaveLength(1);
  });

  /** 這三條是同一件事的三種失敗形態：都必須 502，而且**都不能打到上游**。 */
  it.each([
    ["metadata server 連不上", new Error("ECONNREFUSED")],
    ["metadata server 回非 2xx", { ok: false } as const],
    ["metadata server 回空字串", { ok: true, body: "   " } as const],
  ])("%s → 502，而且不會不帶 token 就送出去", async (_label, metadata) => {
    process.env.ANALYSIS_SERVICE_AUDIENCE = "https://analysis.run.app";
    const mock = stubFetch(metadata as Parameters<typeof stubFetch>[0]);

    await expect(fetchAnalysisService(buildAnalysisServiceUrl("/companies"))).rejects.toMatchObject({ statusCode: 502 });

    const upstreamCalls = mock.mock.calls.filter(([input]) => (input instanceof URL ? input.href : String(input)).includes("analysis.test"));
    expect(upstreamCalls).toHaveLength(0);
  });

  it("上游連不上時仍然是 502，訊息不含內部網址", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;

    await expect(fetchAnalysisService(buildAnalysisServiceUrl("/companies"))).rejects.toMatchObject({
      statusCode: 502,
      message: "Could not reach the analysis service",
    });
  });
});
