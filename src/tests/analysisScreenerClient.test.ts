import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchCompanyRank,
  fetchDistribution,
  fetchScreenerRanking,
  fetchScreenerResults,
  fetchScreenerValues,
} from "@/infrastructure/analysisApi/screener/analysisScreenerClient.js";

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

describe("fetchScreenerResults", () => {
  it("POSTs filters/columns/pagination to /screener and normalizes numeric values to strings", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        count: 30,
        page: 1,
        pageSize: 3,
        totalPages: 10,
        results: [
          {
            symbol: "1210",
            companyName: "華瓊",
            values: {
              "roe.roeTtmPct": { value: 13.33, knowledgeDate: "26Q2", nullReason: null },
              "debtRatio.debtRatioPct": { value: 55.78, knowledgeDate: "26Q2", nullReason: null },
            },
          },
        ],
      },
    });

    const result = await fetchScreenerResults(
      [{ field: "roe.roeTtmPct", min: 10, max: null, exclude: false }],
      [{ field: "roe.roeTtmPct" }, { field: "debtRatio.debtRatioPct" }],
      { page: 1, pageSize: 3 },
    );

    expect(result).toEqual({
      count: 30,
      page: 1,
      pageSize: 3,
      totalPages: 10,
      results: [
        {
          symbol: "1210",
          name: "華瓊",
          values: {
            "roe.roeTtmPct": { value: "13.33", knowledgeDate: "26Q2", nullReason: null },
            "debtRatio.debtRatioPct": { value: "55.78", knowledgeDate: "26Q2", nullReason: null },
          },
        },
      ],
    });

    const call = vi.mocked(globalThis.fetch).mock.calls[0];
    const url = call?.[0] as URL;
    const init = call?.[1] as RequestInit;
    expect(url.toString()).toBe("http://filters.test/screener");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      filters: [{ field: "roe.roeTtmPct", min: 10, max: null, exclude: false }],
      columns: [{ field: "roe.roeTtmPct" }, { field: "debtRatio.debtRatioPct" }],
      page: 1,
      pageSize: 3,
    });
  });

  it("keeps a null value as null rather than stringifying it", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        count: 1,
        page: 1,
        pageSize: 50,
        totalPages: 1,
        results: [{ symbol: "2330", values: { "per.peRatio": { value: null, knowledgeDate: null, nullReason: null } } }],
      },
    });

    const result = await fetchScreenerResults([], [{ field: "per.peRatio" }], { page: 1, pageSize: 50 });

    expect(result.results[0]?.values["per.peRatio"]).toEqual({ value: null, knowledgeDate: null, nullReason: null });
  });

  // Regression coverage for the asOfDate -> knowledgeDate rename + nullReason addition (analysis-ts,
  // 2026-09-13, commit 7549119) — a null value now comes with a machine-readable reason instead of just
  // a bare null, same 4-value convention as metric-history's nullReason.
  it("passes through nullReason alongside a null value", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        count: 1,
        page: 1,
        pageSize: 50,
        totalPages: 1,
        results: [
          {
            symbol: "2891",
            values: { "altmanZScore.TTM": { value: null, knowledgeDate: "2026-06-30", nullReason: "not_applicable_industry" } },
          },
        ],
      },
    });

    const result = await fetchScreenerResults([], [{ field: "altmanZScore.TTM" }], { page: 1, pageSize: 50 });

    expect(result.results[0]?.values["altmanZScore.TTM"]).toEqual({
      value: null,
      knowledgeDate: "2026-06-30",
      nullReason: "not_applicable_industry",
    });
  });

  // Regression: analysis-ts's exclude=true with no min/max filters out everything (count:0, results:[])
  // — verified live and confirmed with them directly. Just needs a clean passthrough, not special logic.
  it("passes through a count:0/results:[] response cleanly", async () => {
    mockFetchOnce({ ok: true, body: { count: 0, page: 1, pageSize: 3, totalPages: 0, results: [] } });

    const result = await fetchScreenerResults(
      [{ field: "roe.roeTtmPct", min: null, max: null, exclude: true }],
      [],
      { page: 1, pageSize: 3 },
    );

    expect(result).toEqual({ count: 0, page: 1, pageSize: 3, totalPages: 0, results: [] });
  });

  it("relays analysis-ts's 400 message for an unknown field as a 400 AppError", async () => {
    mockFetchOnce({ ok: false, status: 400, body: { message: '"nope.nope" 不是 /filters 有列出的欄位' } });

    await expect(fetchScreenerResults([{ field: "nope.nope", min: 0, max: null, exclude: false }], [], { page: 1, pageSize: 50 })).rejects.toMatchObject({
      statusCode: 400,
      message: '"nope.nope" 不是 /filters 有列出的欄位',
    });
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchScreenerResults([], [], { page: 1, pageSize: 50 })).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError for a non-400 non-2xx status", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchScreenerResults([], [], { page: 1, pageSize: 50 })).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response is missing required fields", async () => {
    mockFetchOnce({ ok: true, body: { count: 1 } });

    await expect(fetchScreenerResults([], [], { page: 1, pageSize: 50 })).rejects.toMatchObject({ statusCode: 502 });
  });

  it("includes sectorCodes as an array in the POST body when given", async () => {
    mockFetchOnce({ ok: true, body: { count: 0, page: 1, pageSize: 50, totalPages: 0, results: [] } });

    await fetchScreenerResults([], [], { page: 1, pageSize: 50 }, undefined, ["24", "01"]);

    const init = vi.mocked(globalThis.fetch).mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toMatchObject({ sectorCodes: ["24", "01"] });
  });

  it("omits sectorCodes from the POST body when empty or not given", async () => {
    mockFetchOnce({ ok: true, body: { count: 0, page: 1, pageSize: 50, totalPages: 0, results: [] } });

    await fetchScreenerResults([], [], { page: 1, pageSize: 50 }, undefined, []);

    const init = vi.mocked(globalThis.fetch).mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).not.toHaveProperty("sectorCodes");
  });
});

describe("fetchScreenerRanking", () => {
  it("GETs /screener/ranking with field/direction/limit and a comma-joined columns param", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        results: [
          {
            symbol: "2330",
            companyName: "台積電",
            values: { "roe.roeTtmPct": { value: 34.78, knowledgeDate: "26Q2", nullReason: null } },
          },
        ],
      },
    });

    const result = await fetchScreenerRanking("roe.roeTtmPct", "desc", 10, [{ field: "debtRatio.debtRatioPct" }]);

    expect(result).toEqual({
      results: [
        { symbol: "2330", name: "台積電", values: { "roe.roeTtmPct": { value: "34.78", knowledgeDate: "26Q2", nullReason: null } } },
      ],
    });
    const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(url.toString()).toBe(
      "http://filters.test/screener/ranking?field=roe.roeTtmPct&direction=desc&limit=10&columns=debtRatio.debtRatioPct",
    );
  });

  it("omits the columns param entirely when there are no extra columns", async () => {
    mockFetchOnce({ ok: true, body: { results: [] } });

    await fetchScreenerRanking("roe.roeTtmPct", "asc", 5, []);

    const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(url.searchParams.has("columns")).toBe(false);
  });

  it("includes sectorCodes as a comma-joined query param when given", async () => {
    mockFetchOnce({ ok: true, body: { results: [] } });

    await fetchScreenerRanking("roe.roeTtmPct", "desc", 10, [], ["24", "01"]);

    const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(url.searchParams.get("sectorCodes")).toBe("24,01");
  });

  it("omits the sectorCodes param entirely when empty or not given", async () => {
    mockFetchOnce({ ok: true, body: { results: [] } });

    await fetchScreenerRanking("roe.roeTtmPct", "desc", 10, [], []);

    const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(url.searchParams.has("sectorCodes")).toBe(false);
  });

  it("relays analysis-ts's 400 message for an unknown field", async () => {
    mockFetchOnce({ ok: false, status: 400, body: { message: '"nope.nope" 不是 /filters 有列出的欄位' } });

    await expect(fetchScreenerRanking("nope.nope", "desc", 10, [])).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws a 502 AppError when the response is missing a results array", async () => {
    mockFetchOnce({ ok: true, body: {} });

    await expect(fetchScreenerRanking("roe.roeTtmPct", "desc", 10, [])).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchScreenerRanking("roe.roeTtmPct", "desc", 10, [])).rejects.toMatchObject({ statusCode: 502 });
  });
});

describe("fetchScreenerValues", () => {
  it("POSTs symbols/columns to /screener/values and normalizes numeric values to strings", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        results: [
          {
            symbol: "2330",
            companyName: "台積電",
            values: { "roe.roeTtmPct": { value: 34.78, knowledgeDate: "26Q2", nullReason: null } },
          },
          { symbol: "2317", companyName: "鴻海", values: {} },
        ],
      },
    });

    const result = await fetchScreenerValues(["2330", "2317"], [{ field: "roe.roeTtmPct" }]);

    expect(result).toEqual({
      results: [
        { symbol: "2330", name: "台積電", values: { "roe.roeTtmPct": { value: "34.78", knowledgeDate: "26Q2", nullReason: null } } },
        { symbol: "2317", name: "鴻海", values: {} },
      ],
    });

    const call = vi.mocked(globalThis.fetch).mock.calls[0];
    const url = call?.[0] as URL;
    const init = call?.[1] as RequestInit;
    expect(url.toString()).toBe("http://filters.test/screener/values");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      symbols: ["2330", "2317"],
      columns: [{ field: "roe.roeTtmPct" }],
    });
  });

  it("relays analysis-ts's 400 message for an unknown field", async () => {
    mockFetchOnce({ ok: false, status: 400, body: { message: '"nope.nope" 不是 /filters 有列出的欄位' } });

    await expect(fetchScreenerValues(["2330"], [{ field: "nope.nope" }])).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws a 502 AppError when the response is missing a results array", async () => {
    mockFetchOnce({ ok: true, body: {} });

    await expect(fetchScreenerValues(["2330"], [{ field: "roe.roeTtmPct" }])).rejects.toMatchObject({
      statusCode: 502,
    });
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchScreenerValues(["2330"], [{ field: "roe.roeTtmPct" }])).rejects.toMatchObject({
      statusCode: 502,
    });
  });
});

// Real shape given directly by analysis-ts (2026-09-16).
describe("fetchCompanyRank", () => {
  it("requests /screener/company-rank with symbol/field/direction and normalizes the result", async () => {
    mockFetchOnce({
      ok: true,
      body: { symbol: "2330", field: "dividendYield.EOD", found: true, value: 0.92, rank: 1152, totalCount: 1583, topPercent: 72.8, quintile: 2 },
    });

    const result = await fetchCompanyRank("2330", "dividendYield.EOD", "desc", undefined);

    expect(result).toEqual({ symbol: "2330", field: "dividendYield.EOD", found: true, value: 0.92, rank: 1152, totalCount: 1583, topPercent: 72.8, quintile: 2 });
    const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(url.toString()).toBe("http://filters.test/screener/company-rank?symbol=2330&field=dividendYield.EOD&direction=desc");
  });

  // excludeZero (2026-09-24). analysis-ts parses it as "present means yes" rather than as a boolean —
  // excludeZero=false and excludeZero=bogus both exclude zeros there, verified live. So bff-ts sends the
  // parameter only when it is true; false must reach the wire as an absent parameter, or a caller that
  // explicitly asked to KEEP zero-yield companies would silently get them filtered out.
  it.each([
    [true, "&excludeZero=true"],
    [false, ""],
    [undefined, ""],
  ])("sends excludeZero upstream only when it is true (%s)", async (value, expectedSuffix) => {
    mockFetchOnce({
      ok: true,
      body: { symbol: "2330", field: "dividendYield.EOD", found: true, value: 0.92, rank: 1259, totalCount: 1445, topPercent: 87.1 },
    });

    await fetchCompanyRank("2330", "dividendYield.EOD", "desc", value);

    const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(url.toString()).toBe(
      `http://filters.test/screener/company-rank?symbol=2330&field=dividendYield.EOD&direction=desc${expectedSuffix}`,
    );
  });

  // Confirmed live: an unknown symbol, or a field with no data for this symbol, is still a 200.
  it("returns found:false with every numeric field null, without throwing", async () => {
    mockFetchOnce({
      ok: true,
      body: { symbol: "NOPE9999", field: "dividendYield.EOD", found: false, value: null, rank: null, totalCount: null, topPercent: null, quintile: null },
    });

    const result = await fetchCompanyRank("NOPE9999", "dividendYield.EOD", "desc", undefined);

    expect(result).toEqual({ symbol: "NOPE9999", field: "dividendYield.EOD", found: false, value: null, rank: null, totalCount: null, topPercent: null, quintile: null });
  });

  it("relays analysis-ts's 400 message for an unknown field", async () => {
    mockFetchOnce({ ok: false, status: 400, body: { message: '"nope.nope" 不是可查詢的欄位' } });

    await expect(fetchCompanyRank("2330", "nope.nope", "desc", undefined)).rejects.toMatchObject({
      statusCode: 400,
      message: '"nope.nope" 不是可查詢的欄位',
    });
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchCompanyRank("2330", "dividendYield.EOD", "desc", undefined)).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response is missing symbol/field/found", async () => {
    mockFetchOnce({ ok: true, body: {} });

    await expect(fetchCompanyRank("2330", "dividendYield.EOD", "desc", undefined)).rejects.toMatchObject({ statusCode: 502 });
  });
});

const DISTRIBUTION_BODY = {
  field: "dividendYield.EOD",
  totalCount: 1445,
  trueMin: 0.01,
  trueMax: 18.2,
  clippedMin: 0.01,
  clippedMax: 12,
  bins: [{ min: 0.01, max: 0.6, count: 72 }],
  quantiles: { p20: 1.298, p40: 2.62, p60: 4.07, p80: 5.772 },
};

describe("fetchDistribution", () => {
  // This endpoint had no client tests at all until 2026-09-24, which is how the excludeZero=false bug
  // below survived: the parameter was forwarded as the string "false", and analysis-ts treats any
  // present value as "yes", so asking to KEEP zero-yield companies quietly dropped 278 of them.
  it.each([
    [true, "&excludeZero=true"],
    [false, ""],
    [undefined, ""],
  ])("sends excludeZero upstream only when it is true (%s)", async (value, expectedSuffix) => {
    mockFetchOnce({ ok: true, body: DISTRIBUTION_BODY });

    await fetchDistribution("dividendYield.EOD", undefined, value);

    const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(url.toString()).toBe(`http://filters.test/screener/distribution?field=dividendYield.EOD${expectedSuffix}`);
  });

  it("omits bins when not given, so analysis-ts applies its own default bucketing", async () => {
    mockFetchOnce({ ok: true, body: DISTRIBUTION_BODY });

    await fetchDistribution("dividendYield.EOD", 20, undefined);

    const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(url.toString()).toBe("http://filters.test/screener/distribution?field=dividendYield.EOD&bins=20");
  });

  it("passes the quintile boundaries through", async () => {
    mockFetchOnce({ ok: true, body: DISTRIBUTION_BODY });

    const result = await fetchDistribution("dividendYield.EOD", undefined, true);

    expect(result.quantiles).toEqual({ p20: 1.298, p40: 2.62, p60: 4.07, p80: 5.772 });
  });

  // An empty population is a legitimate answer, not a malformed one: analysis-ts sends totalCount 0 with
  // every range null (a monthly metric before its first month lands). bff-ts used to demand numbers and
  // turned that into a 502 claiming the fields were missing.
  it("returns an empty distribution instead of a 502 when the population is empty", async () => {
    mockFetchOnce({
      ok: true,
      body: { field: "sus.M", totalCount: 0, trueMin: null, trueMax: null, clippedMin: null, clippedMax: null, bins: [], quantiles: null },
    });

    await expect(fetchDistribution("sus.M", undefined, true)).resolves.toEqual({
      field: "sus.M",
      totalCount: 0,
      trueMin: null,
      trueMax: null,
      clippedMin: null,
      clippedMax: null,
      bins: [],
      quantiles: null,
    });
  });

  // All four boundaries or nothing — a partial set would let a caller label an axis with gaps.
  it("drops a partial quantiles object rather than half-labelling an axis", async () => {
    mockFetchOnce({ ok: true, body: { ...DISTRIBUTION_BODY, quantiles: { p20: 1.3, p40: 2.6 } } });

    await expect(fetchDistribution("dividendYield.EOD", undefined, true)).resolves.toMatchObject({ quantiles: null });
  });

  it("rejects a malformed response with a 502 rather than passing a broken histogram on", async () => {
    mockFetchOnce({ ok: true, body: { ...DISTRIBUTION_BODY, bins: "not an array" } });

    await expect(fetchDistribution("dividendYield.EOD", undefined, undefined)).rejects.toMatchObject({ statusCode: 502 });
  });
});
