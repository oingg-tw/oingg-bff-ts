import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchBrokers } from "@/infrastructure/analysisApi/brokers/brokers.client.js";

const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
  process.env.FILTERS_SERVICE_URL = "http://filters.test";
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  globalThis.fetch = vi.fn().mockResolvedValue({ ok, status, json: () => Promise.resolve(body) }) as unknown as typeof fetch;
}

/** 貼近 2026-10-05 實測的上游回應：60 家、name 全是 null。 */
const RAW = {
  asOfDate: "2026-10-04",
  brokers: [
    { brokerCode: "1020", name: null, shortName: "合庫" },
    { brokerCode: "9800", name: null, shortName: "元大" },
  ],
};

describe("fetchBrokers", () => {
  it("requests /brokers with no parameters and passes every field through", async () => {
    mockFetchOnce(RAW);

    await expect(fetchBrokers()).resolves.toEqual(RAW);
    const url = new URL((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string);
    expect(url.pathname).toBe("/brokers");
    expect([...url.searchParams.keys()]).toEqual([]);
  });

  it("keeps a missing asOfDate as null", async () => {
    mockFetchOnce({ ...RAW, asOfDate: null });

    await expect(fetchBrokers()).resolves.toMatchObject({ asOfDate: null });
  });

  // 下拉選單的值與顯示文字缺了就是契約被破壞——不能送出一個空字串選項。
  it("throws 502 instead of shipping a broker without a code or a short name", async () => {
    mockFetchOnce({ ...RAW, brokers: [{ brokerCode: "9800", name: null, shortName: "" }] });
    await expect(fetchBrokers()).rejects.toMatchObject({ statusCode: 502 });

    mockFetchOnce({ asOfDate: "2026-10-04" });
    await expect(fetchBrokers()).rejects.toMatchObject({ statusCode: 502 });
  });
});
