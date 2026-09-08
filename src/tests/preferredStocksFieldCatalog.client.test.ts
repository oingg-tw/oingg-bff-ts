import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchPreferredStockFieldCatalog } from "@/domainBff/stock/preferredStocksFieldCatalog.client.js";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_FILTERS_URL = process.env.FILTERS_SERVICE_URL;

beforeEach(() => {
  process.env.FILTERS_SERVICE_URL = "http://filters.test";
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_FILTERS_URL === undefined) {
    delete process.env.FILTERS_SERVICE_URL;
  } else {
    process.env.FILTERS_SERVICE_URL = ORIGINAL_FILTERS_URL;
  }
});

function mockFetchOnce(response: { ok: boolean; status?: number; body: unknown }) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? 200,
    json: () => Promise.resolve(response.body),
  }) as unknown as typeof fetch;
}

// Real response given directly by analysis-ts (2026-09-08).
const RAW_BODY = {
  fields: [
    {
      field: "premiumRatePct",
      label: "溢價率",
      formula: "(latestClosePrice - issuePrice) / issuePrice * 100，只在 redeemable=true 時才計算",
      inputs: ["latestClosePrice", "issuePrice", "redeemable"],
    },
    {
      field: "ytcAssumption",
      label: "YTC 期數假設",
      formula: "非計算欄位，是 ytcPct 期數(n)採用哪種假設的分類標記",
      inputs: ["redemptionDate", "redeemable"],
    },
  ],
};

describe("fetchPreferredStockFieldCatalog", () => {
  it("requests /preferred-stocks/field-catalog and passes through fields unchanged", async () => {
    mockFetchOnce({ ok: true, body: RAW_BODY });

    const result = await fetchPreferredStockFieldCatalog();

    expect(result).toEqual(RAW_BODY);
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/preferred-stocks/field-catalog");
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchPreferredStockFieldCatalog()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError for a non-2xx status", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchPreferredStockFieldCatalog()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response is missing a fields array", async () => {
    mockFetchOnce({ ok: true, body: {} });

    await expect(fetchPreferredStockFieldCatalog()).rejects.toMatchObject({ statusCode: 502 });
  });
});
