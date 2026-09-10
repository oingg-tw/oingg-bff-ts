import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchPiotroskiBreakdown } from "@/domainBff/stock/piotroskiBreakdown.client.js";

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

// Real 2330 example, given directly by analysis-ts (2026-09-10).
const FOUND_BODY = {
  symbol: "2330",
  found: true,
  fiscalYear: 2026,
  fiscalQuarter: 2,
  knowledgeDate: "2026-08-11",
  knowledgeDateIsFallback: false,
  totalScore: 8,
  groups: {
    profitability: { positiveRoa: true, positiveCfo: true, roaImproved: true, accrualQuality: true },
    leverageLiquidity: { leverageDecreased: false, liquidityImproved: true, noDilution: true },
    operatingEfficiency: { grossMarginImproved: true, assetTurnoverImproved: true },
  },
};

const NOT_FOUND_BODY = {
  symbol: "9999999",
  found: false,
  fiscalYear: null,
  fiscalQuarter: null,
  knowledgeDate: null,
  knowledgeDateIsFallback: null,
  totalScore: null,
  groups: null,
};

describe("fetchPiotroskiBreakdown", () => {
  it("requests /companies/piotroski-breakdown with just symbol and passes through the response", async () => {
    mockFetchOnce({ ok: true, body: FOUND_BODY });

    const result = await fetchPiotroskiBreakdown("2330");

    expect(result).toEqual(FOUND_BODY);
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/companies/piotroski-breakdown?symbol=2330");
  });

  it("includes year/season in the request when both are given", async () => {
    mockFetchOnce({ ok: true, body: FOUND_BODY });

    await fetchPiotroskiBreakdown("2330", "115", "2");

    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/companies/piotroski-breakdown?symbol=2330&year=115&season=2");
  });

  it("returns found:false with every other field null for an unknown symbol, without throwing", async () => {
    mockFetchOnce({ ok: true, body: NOT_FOUND_BODY });

    await expect(fetchPiotroskiBreakdown("9999999")).resolves.toEqual(NOT_FOUND_BODY);
  });

  // A group's own boolean signal can be null (the same all-or-null propagation analysis-ts already
  // applies to piotroskiFScore.Q) even while found is true and totalScore is a real number for the other
  // groups — bff-ts must preserve that per-signal null, not coerce it to false.
  it("preserves a null boolean signal within a group as null, not coerced to false", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        ...FOUND_BODY,
        groups: {
          ...FOUND_BODY.groups,
          profitability: { ...FOUND_BODY.groups.profitability, accrualQuality: null },
        },
      },
    });

    const result = await fetchPiotroskiBreakdown("2330");

    expect(result.groups?.profitability.accrualQuality).toBeNull();
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchPiotroskiBreakdown("2330")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError for a non-2xx status", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchPiotroskiBreakdown("2330")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response body isn't an object", async () => {
    mockFetchOnce({ ok: true, body: null });

    await expect(fetchPiotroskiBreakdown("2330")).rejects.toMatchObject({ statusCode: 502 });
  });
});
