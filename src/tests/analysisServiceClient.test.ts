import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertAnalysisServiceOk,
  buildAnalysisServiceUrl,
  fetchAnalysisService,
  pingAnalysisService,
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
  process.env.BUSINESS_API_KEY = "test-key";
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
  it("金鑰 BUSINESS_API_KEY 放在 X-Api-Key；沒設就丟錯", async () => {
    const original = process.env.BUSINESS_API_KEY;
    try {
      process.env.BUSINESS_API_KEY = "new-key";
      const mock = stubFetch(undefined);
      await fetchAnalysisService(buildAnalysisServiceUrl("/companies"));
      expect(headersOf(mock, "analysis.test").get("X-Api-Key")).toBe("new-key");

      delete process.env.BUSINESS_API_KEY;
      await expect(fetchAnalysisService(buildAnalysisServiceUrl("/companies"))).rejects.toThrow(/BUSINESS_API_KEY/);
    } finally {
      if (original === undefined) {
        delete process.env.BUSINESS_API_KEY;
      } else {
        process.env.BUSINESS_API_KEY = original;
      }
    }
  });

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
      code: "upstream_unavailable",
      message: "Could not reach the analysis service",
    });
  });

  it("逾時是 504 upstream_timeout，跟連不上的 502 分得開", async () => {
    // AbortSignal.timeout 到期時 fetch 丟的就是這個（DOMException，name 為 TimeoutError）。
    globalThis.fetch = vi.fn().mockRejectedValue(new DOMException("The operation was aborted due to timeout", "TimeoutError")) as unknown as typeof fetch;

    await expect(fetchAnalysisService(buildAnalysisServiceUrl("/companies"))).rejects.toMatchObject({
      statusCode: 504,
      code: "upstream_timeout",
    });
  });
});

/**
 * assertAnalysisServiceOk 是上游非 2xx 的**唯一**出口，所以這裡守的東西對全部 29 個 client 一起生效。
 *
 * 2026-09-30 把 400 的處理搬進它之前，同一個區塊被複製到 10 個 client、另外 19 個沒有——那 19 支把上游的
 * 「year 必須是民國年」變成 `502 "... returned 400"`，再被前端渲染成「目前沒有 OO 資料」。所以這裡真正要守的
 * 是兩件事：**4xx 不能變成 5xx**，以及**兩種 400 形狀都要挖得出那句有用的話**。
 */
describe("assertAnalysisServiceOk", () => {
  const url = new URL("http://analysis.test/companies/x");
  const respond = (status: number, body: unknown) =>
    ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) }) as Response;

  it("2xx 時什麼都不做", async () => {
    await expect(assertAnalysisServiceOk(respond(200, {}), url, "Test endpoint")).resolves.toBeUndefined();
  });

  /** analysis-ts 2026-10-08 起的 RFC 9457 形狀（實測他們的 DEV 回應）。 */
  it("RFC 9457 的驗證錯誤：串起 errors[].detail，不用籠統的頂層 detail", async () => {
    const body = {
      message: "metricCode is required.",
      errors: [{ detail: "metricCode is required.", parameter: "metricCode" }, { detail: "timeframe is required.", parameter: "timeframe" }],
      type: "about:blank",
      status: 400,
      detail: "Invalid query parameters.",
    };
    await expect(assertAnalysisServiceOk(respond(400, body), url, "Test endpoint"))
      .rejects.toMatchObject({ statusCode: 400, message: "metricCode is required.; timeframe is required.", code: undefined });
  });

  it("RFC 9457 帶 code 的錯誤：detail 當訊息、code 原樣轉出（前端只靠 code 分支）", async () => {
    const body = { type: "tag:oingg.com,2026:unsupported-timeframe", status: 400, detail: "不支援 periodType Q", code: "unsupported_timeframe" };
    await expect(assertAnalysisServiceOk(respond(400, body), url, "Test endpoint"))
      .rejects.toMatchObject({ statusCode: 400, message: "不支援 periodType Q", code: "unsupported_timeframe" });
  });

  it("扁平的 400 直接帶出頂層 message", async () => {
    await expect(assertAnalysisServiceOk(respond(400, { message: "metricCodes 最多 10 個，收到 11 個。" }), url, "Test endpoint"))
      .rejects.toMatchObject({ statusCode: 400, message: "metricCodes 最多 10 個，收到 11 個。" });
  });

  /**
   * 這一條是那次真正的缺口的迴歸測試：zod 的 error tree 頂層 message 一律是無資訊的
   * "Invalid query parameters."，唯一有用的那句在欄位層。只讀頂層的話，使用者拿到的訊息等於沒有訊息。
   */
  it("嵌套的 400 挖出欄位層訊息，而不是無資訊的頂層 message", async () => {
    const body = {
      message: "Invalid query parameters.",
      errors: { _errors: [], year: { _errors: ['year 必須是民國年數字字串，例如 "115"。'] } },
    };
    await expect(assertAnalysisServiceOk(respond(400, body), url, "Test endpoint"))
      .rejects.toMatchObject({ statusCode: 400, message: 'year 必須是民國年數字字串，例如 "115"。' });
  });

  /** 不綁欄位名：觸發嵌套形狀的是 year/season/metricCode 等不同欄位，寫死一個等於只修一支端點。 */
  it("欄位名不是 year 也挖得出來", async () => {
    const body = { message: "Invalid query parameters.", errors: { _errors: [], season: { _errors: ["season 必須是 1~4。"] } } };
    await expect(assertAnalysisServiceOk(respond(400, body), url, "Test endpoint"))
      .rejects.toMatchObject({ statusCode: 400, message: "season 必須是 1~4。" });
  });

  it("400 但 body 挖不出訊息時仍是 400，用通用訊息", async () => {
    await expect(assertAnalysisServiceOk(respond(400, {}), url, "Test endpoint"))
      .rejects.toMatchObject({ statusCode: 400, message: "Invalid Test endpoint request" });
  });

  it("400 以外的非 2xx 一律 502，且訊息不含內部 URL", async () => {
    for (const status of [401, 404, 500, 503]) {
      const error = await assertAnalysisServiceOk(respond(status, {}), url, "Test endpoint").catch((e: unknown) => e);
      expect(error).toMatchObject({ statusCode: 502 });
      expect(String((error as Error).message)).not.toContain("analysis.test");
    }
  });
});

describe("pingAnalysisService", () => {
  it("analysis-ts 的 /health 503 時，把它說的是哪個上游帶進錯誤訊息", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.resolve({ status: 503, detail: "Database or upstream export view not available: twse, sitca." }),
    }) as unknown as typeof fetch;

    await expect(pingAnalysisService()).rejects.toThrow("analysis-ts /health returned 503: Database or upstream export view not available: twse, sitca.");
  });

  it("200 時什麼都不做", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ status: "ok" }) }) as unknown as typeof fetch;

    await expect(pingAnalysisService()).resolves.toBeUndefined();
  });
});
