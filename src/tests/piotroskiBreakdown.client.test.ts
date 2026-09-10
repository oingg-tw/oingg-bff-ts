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

// Real group metadata/signal labels, given directly by analysis-ts (2026-09-11) — static reference data,
// stays populated even when found is false (confirmed live against an unknown symbol).
const GROUP_METADATA = [
  {
    key: "profitability",
    name: "獲利能力",
    nameEn: "Profitability",
    summary: "公司本業有沒有在賺錢、賺得比去年好。",
    detail: "對應 Piotroski (2000) 原始論文的 4 個獲利能力訊號。",
    denominator: 4,
  },
  {
    key: "leverageLiquidity",
    name: "財務槓桿與流動性",
    nameEn: "Leverage, Liquidity & Source of Funds",
    summary: "公司償債能力有沒有變好、有沒有靠稀釋股權籌資。",
    detail: "對應原始論文的 3 個財務結構訊號。",
    denominator: 3,
  },
  {
    key: "operatingEfficiency",
    name: "營運效率",
    nameEn: "Operating Efficiency",
    summary: "公司賺錢的效率跟資產運用的效率有沒有比去年好。",
    detail: "對應原始論文的 2 個營運效率訊號。",
    denominator: 2,
  },
];

const SIGNAL_LABELS = {
  positiveRoa: "資產報酬率（ROA）為正",
  positiveCfo: "營業現金流為正",
  roaImproved: "ROA 較去年同季提升",
  accrualQuality: "營業現金流大於淨利（應計項目品質良好）",
  leverageDecreased: "長期負債比率較去年同季下降",
  liquidityImproved: "流動比率較去年同季提升",
  noDilution: "流通股數未增加（無股權稀釋）",
  grossMarginImproved: "毛利率較去年同季提升",
  assetTurnoverImproved: "總資產週轉率較去年同季提升",
};

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
  groupMetadata: GROUP_METADATA,
  signalLabels: SIGNAL_LABELS,
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
  groupMetadata: GROUP_METADATA,
  signalLabels: SIGNAL_LABELS,
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

  // groupMetadata/signalLabels (2026-09-11): static reference metadata describing the methodology itself,
  // not this symbol's data — must stay populated even when found is false, unlike groups.
  it("keeps groupMetadata and signalLabels populated even when found is false", async () => {
    mockFetchOnce({ ok: true, body: NOT_FOUND_BODY });

    const result = await fetchPiotroskiBreakdown("9999999");

    expect(result.groupMetadata).toEqual(GROUP_METADATA);
    expect(result.signalLabels).toEqual(SIGNAL_LABELS);
  });

  it("drops a groupMetadata entry with an unrecognized key instead of passing it through", async () => {
    mockFetchOnce({
      ok: true,
      body: { ...FOUND_BODY, groupMetadata: [...GROUP_METADATA, { key: "bogus", name: "x", nameEn: "x", summary: "x", detail: "x", denominator: 1 }] },
    });

    const result = await fetchPiotroskiBreakdown("2330");

    expect(result.groupMetadata).toEqual(GROUP_METADATA);
  });

  it("defaults groupMetadata to [] and signalLabels to {} when either is absent from the response", async () => {
    const { groupMetadata: _groupMetadata, signalLabels: _signalLabels, ...bodyWithoutMetadata } = FOUND_BODY;
    mockFetchOnce({ ok: true, body: bodyWithoutMetadata });

    const result = await fetchPiotroskiBreakdown("2330");

    expect(result.groupMetadata).toEqual([]);
    expect(result.signalLabels).toEqual({});
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
