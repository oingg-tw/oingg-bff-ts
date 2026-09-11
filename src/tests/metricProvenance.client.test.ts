import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMetricProvenance } from "@/domainBff/stock/metricProvenance.client.js";

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

// Real 2330 roe example, given directly by analysis-ts (2026-09-10).
const ROE_BODY = {
  symbol: "2330",
  metricCode: "roe",
  found: true,
  fiscalYear: 2026,
  fiscalQuarter: 2,
  value: 34.78,
  entries: [
    {
      role: "本季期末權益（TTM 分母不取平均，固定用本季單一期末值）",
      fiscalYear: 2026,
      fiscalQuarter: 2,
      type: "statementField",
      statementType: "balanceSheet",
      fieldKey: "equity_attributable_to_owners_of_parent",
      sourceDescription: null,
      value: "6432518334",
    },
  ],
  methodologyNote: null,
};

// Real 2330 chowderNumber example — includes an entry whose value is a plain float (0.92), unlike every
// other confirmed entry which is a bigint-serialized string. bff-ts must preserve this as-is.
const CHOWDER_NUMBER_BODY = {
  symbol: "2330",
  metricCode: "chowderNumber",
  found: true,
  fiscalYear: 2026,
  fiscalQuarter: 2,
  value: 13.39,
  entries: [
    {
      role: "現金殖利率（市場快照）",
      fiscalYear: null,
      fiscalQuarter: null,
      type: "other",
      statementType: null,
      fieldKey: null,
      sourceDescription: "證交所／櫃買中心每日評價指標（本益比／股價淨值比／殖利率）",
      value: 0.92,
    },
    {
      role: "2025 年底流通股數",
      fiscalYear: 2025,
      fiscalQuarter: null,
      type: "other",
      statementType: null,
      fieldKey: null,
      sourceDescription: "公開發行公司股本變動申報",
      value: "25932524521",
    },
  ],
  methodologyNote: null,
};

const NOT_FOUND_BODY = {
  symbol: "9999999",
  metricCode: "roe",
  found: false,
  fiscalYear: null,
  fiscalQuarter: null,
  value: null,
  entries: [],
  methodologyNote: null,
};

describe("fetchMetricProvenance", () => {
  it("requests /companies/{symbol}/metric-provenance with symbol as a path segment and metricCode as a query param", async () => {
    mockFetchOnce({ ok: true, body: ROE_BODY });

    const result = await fetchMetricProvenance("2330", "roe");

    expect(result).toEqual(ROE_BODY);
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/companies/2330/metric-provenance?metricCode=roe");
  });

  it("includes year/season in the request when both are given", async () => {
    mockFetchOnce({ ok: true, body: ROE_BODY });

    await fetchMetricProvenance("2330", "roe", "115", "2");

    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/companies/2330/metric-provenance?metricCode=roe&year=115&season=2");
  });

  // Pilot scope expanded 2026-09-11 (analysis-ts commit fd0416a) from 3 metricCodes to 6 — accrualsRatio,
  // dividendPayoutRatio, and altmanZScore are the 3 new ones, verified live against real 2330 data.
  it.each(["accrualsRatio", "dividendPayoutRatio", "altmanZScore"] as const)(
    "accepts %s as a valid metricCode (2026-09-11 pilot expansion)",
    async (metricCode) => {
      mockFetchOnce({ ok: true, body: { ...ROE_BODY, metricCode } });

      const result = await fetchMetricProvenance("2330", metricCode);

      expect(result.metricCode).toBe(metricCode);
      const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
      expect(calledUrl.toString()).toBe(`http://filters.test/companies/2330/metric-provenance?metricCode=${metricCode}`);
    },
  );

  // entries[].value has no fixed type — most are bigint-serialized strings, but this live case is a plain
  // float. Both must survive round-trip unchanged, with no coercion toward one or the other.
  it("preserves entries[].value's mixed string/number types with no coercion", async () => {
    mockFetchOnce({ ok: true, body: CHOWDER_NUMBER_BODY });

    const result = await fetchMetricProvenance("2330", "chowderNumber");

    expect(result.entries[0]?.value).toBe(0.92);
    expect(typeof result.entries[0]?.value).toBe("number");
    expect(result.entries[1]?.value).toBe("25932524521");
    expect(typeof result.entries[1]?.value).toBe("string");
  });

  it("returns found:false with an empty entries array and every other field null for an unknown symbol, without throwing", async () => {
    mockFetchOnce({ ok: true, body: NOT_FOUND_BODY });

    await expect(fetchMetricProvenance("9999999", "roe")).resolves.toEqual(NOT_FOUND_BODY);
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchMetricProvenance("2330", "roe")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError for a non-2xx status", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchMetricProvenance("2330", "roe")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response body isn't an object", async () => {
    mockFetchOnce({ ok: true, body: null });

    await expect(fetchMetricProvenance("2330", "roe")).rejects.toMatchObject({ statusCode: 502 });
  });
});
