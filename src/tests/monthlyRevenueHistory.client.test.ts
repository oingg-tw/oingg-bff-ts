import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMonthlyRevenueHistory } from "@/domainBff/stock/monthlyRevenueHistory.client.js";

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

// Real 2330 data given directly by analysis-ts (2026-09-07).
const RECENT_BODY = {
  symbol: "2330",
  total: 60,
  hasMore: true,
  entries: [
    {
      yearMonth: "2026-06",
      reportDate: "2026-07-10",
      industry: "半導體業",
      currentMonthRevenue: "442679969",
      lastYearSameMonthRevenue: "263708978",
      yoyChangePercent: 67.87,
      momChangePercent: 6.16,
      cumulativeRevenue: "2404483690",
      cumulativeLastYearRevenue: "1773045533",
      cumulativeChangePercent: 35.61,
      note: "因先進製程產品需求增加所致。",
    },
    {
      yearMonth: "2026-07",
      reportDate: "2026-08-10",
      industry: "半導體業",
      currentMonthRevenue: "467580548",
      lastYearSameMonthRevenue: "323165707",
      yoyChangePercent: 44.69,
      momChangePercent: 5.62,
      cumulativeRevenue: "2872064238",
      cumulativeLastYearRevenue: "2096211240",
      cumulativeChangePercent: 37.01,
      note: null,
    },
  ],
};

// The earliest month in the 60-month backfill has no prior month to compare against — real data.
const OLDEST_ENTRY = {
  yearMonth: "2021-08",
  reportDate: "2021-09-10",
  industry: "半導體業",
  currentMonthRevenue: "137427162",
  lastYearSameMonthRevenue: "122878244",
  yoyChangePercent: 11.84,
  momChangePercent: null,
  cumulativeRevenue: "996540313",
  cumulativeLastYearRevenue: "850137262",
  cumulativeChangePercent: 17.22,
  note: "無",
};

describe("fetchMonthlyRevenueHistory", () => {
  it("requests /companies/monthly-revenue-history with symbol and normalizes entries (dropping total/hasMore)", async () => {
    mockFetchOnce({ ok: true, body: RECENT_BODY });

    const result = await fetchMonthlyRevenueHistory("2330");

    expect(result).toEqual({ symbol: "2330", entries: RECENT_BODY.entries });
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/companies/monthly-revenue-history?symbol=2330");
  });

  it("includes limit when given", async () => {
    mockFetchOnce({ ok: true, body: RECENT_BODY });

    await fetchMonthlyRevenueHistory("2330", 12);

    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/companies/monthly-revenue-history?symbol=2330&limit=12");
  });

  it("returns an empty entries array for an unbackfilled or unknown symbol, without throwing", async () => {
    mockFetchOnce({ ok: true, body: { symbol: "2317", total: 0, hasMore: false, entries: [] } });

    await expect(fetchMonthlyRevenueHistory("2317")).resolves.toEqual({ symbol: "2317", entries: [] });
  });

  // Revenue amounts are bigint-serialized strings — must be passed through as strings, never coerced
  // to a JS number (precision loss risk for large NT$ figures).
  it("keeps revenue amounts as strings", async () => {
    mockFetchOnce({ ok: true, body: RECENT_BODY });

    const result = await fetchMonthlyRevenueHistory("2330");

    expect(result.entries[0]?.currentMonthRevenue).toBe("442679969");
    expect(typeof result.entries[0]?.currentMonthRevenue).toBe("string");
  });

  // The earliest month in a symbol's backfilled series has no prior month to compare against —
  // momChangePercent is null there even though yoyChangePercent (a different comparison) has a value.
  it("preserves a null momChangePercent on the earliest month while yoyChangePercent still has a value", async () => {
    mockFetchOnce({ ok: true, body: { symbol: "2330", total: 60, hasMore: true, entries: [OLDEST_ENTRY] } });

    const result = await fetchMonthlyRevenueHistory("2330");

    expect(result.entries[0]?.momChangePercent).toBeNull();
    expect(result.entries[0]?.yoyChangePercent).toBe(11.84);
  });

  // analysis-ts sends the literal string "無" (not null) when a company explicitly reports nothing
  // notable — must not be conflated with a genuinely absent note.
  it("keeps a literal '無' note as a real string, distinct from null", async () => {
    mockFetchOnce({ ok: true, body: { symbol: "2330", total: 60, hasMore: true, entries: [OLDEST_ENTRY] } });

    const result = await fetchMonthlyRevenueHistory("2330");

    expect(result.entries[0]?.note).toBe("無");
  });

  it("keeps note null when analysis-ts sends null (no remark filed at all)", async () => {
    const entry = { ...RECENT_BODY.entries[1] };
    mockFetchOnce({ ok: true, body: { symbol: "2330", total: 60, hasMore: true, entries: [entry] } });

    const result = await fetchMonthlyRevenueHistory("2330");

    expect(result.entries[0]?.note).toBeNull();
  });

  it("relays analysis-ts's 400 message (e.g. limit out of its 1-120 bound)", async () => {
    mockFetchOnce({ ok: false, status: 400, body: { message: "Too big: expected number to be <=120" } });

    await expect(fetchMonthlyRevenueHistory("2330", 999)).rejects.toMatchObject({
      statusCode: 400,
      message: "Too big: expected number to be <=120",
    });
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchMonthlyRevenueHistory("2330")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError for a non-2xx, non-400 status", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchMonthlyRevenueHistory("2330")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response is missing an entries array", async () => {
    mockFetchOnce({ ok: true, body: { symbol: "2330" } });

    await expect(fetchMonthlyRevenueHistory("2330")).rejects.toMatchObject({ statusCode: 502 });
  });
});
