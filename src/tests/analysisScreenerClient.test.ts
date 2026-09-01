import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchScreenerRanking, fetchScreenerResults } from "../domains/screener/analysisScreenerClient.js";

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
            values: {
              "roe.roeTtmPct": { value: 13.33, asOfDate: "26Q2" },
              "debtRatio.debtRatioPct": { value: 55.78, asOfDate: "26Q2" },
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
          values: {
            "roe.roeTtmPct": { value: "13.33", asOfDate: "26Q2" },
            "debtRatio.debtRatioPct": { value: "55.78", asOfDate: "26Q2" },
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
        results: [{ symbol: "2330", values: { "per.peRatio": { value: null, asOfDate: null } } }],
      },
    });

    const result = await fetchScreenerResults([], [{ field: "per.peRatio" }], { page: 1, pageSize: 50 });

    expect(result.results[0]?.values["per.peRatio"]).toEqual({ value: null, asOfDate: null });
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
});

describe("fetchScreenerRanking", () => {
  it("GETs /screener/ranking with field/direction/limit and a comma-joined columns param", async () => {
    mockFetchOnce({
      ok: true,
      body: { results: [{ symbol: "2330", values: { "roe.roeTtmPct": { value: 34.78, asOfDate: "26Q2" } } }] },
    });

    const result = await fetchScreenerRanking("roe.roeTtmPct", "desc", 10, [{ field: "debtRatio.debtRatioPct" }]);

    expect(result).toEqual({
      results: [{ symbol: "2330", values: { "roe.roeTtmPct": { value: "34.78", asOfDate: "26Q2" } } }],
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
