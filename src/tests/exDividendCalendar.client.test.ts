import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchExDividendCalendar } from "@/infrastructure/analysisApi/stock/exDividendCalendar.client.js";

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

// Real entries given directly by analysis-ts (2026-09-10; status/paymentDate/fiscalYear added 2026-09-22,
// cf1b752e — an "announced" TWSE notice vs. a "realized" MOPS distribution, which is the only kind that
// carries paymentDate/fiscalYear).
const RAW_BODY = {
  entries: [
    {
      symbol: "00939",
      companyName: null,
      status: "announced",
      paymentDate: null,
      fiscalYear: null,
      exDate: "2026-09-01",
      exType: "息",
      stockDividendRatio: null,
      subscriptionRatio: null,
      subscriptionPricePerShare: null,
      cashDividend: 0.125,
      sharesOffered: null,
      sharesEmpOwner: null,
      sharesholderOwner: null,
      stockHoldingRatio: null,
    },
    {
      symbol: "1465",
      companyName: "偉全",
      status: "realized",
      paymentDate: "2026-08-28",
      fiscalYear: 2025,
      exDate: "2026-08-03",
      exType: "息",
      stockDividendRatio: null,
      subscriptionRatio: null,
      subscriptionPricePerShare: null,
      cashDividend: 0.3,
      sharesOffered: null,
      sharesEmpOwner: null,
      sharesholderOwner: null,
      stockHoldingRatio: null,
    },
  ],
};

describe("fetchExDividendCalendar", () => {
  it("requests /stocks/ex-dividend-calendar with the given month and normalizes entries", async () => {
    mockFetchOnce({ ok: true, body: RAW_BODY });

    const result = await fetchExDividendCalendar("2026-09");

    // RAW_BODY 是 2026-09-10 拿到的真實回應，刻意保留當時的形狀（不補新欄位，否則它就不再是那天的樣本）。
    // 2026-09-23 上游新增的四個欄位在那份樣本裡不存在，所以這一層補 null——而這條仍然在驗「除了那四個
    // 以外一個欄位都沒掉」，因為其餘欄位是逐字 deep-equal。
    const ETF_FIELDS_ABSENT = { securityType: null, recordDate: null, distributionPerUnit: null, composition: null };
    expect(result).toEqual({ entries: RAW_BODY.entries.map((e) => ({ ...e, ...ETF_FIELDS_ABSENT })) });
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/stocks/ex-dividend-calendar?month=2026-09");
  });

  // ETFs aren't in analysis-ts's company reference table — companyName stays null, not coerced to "".
  it("keeps companyName null for a symbol with no company reference (e.g. an ETF)", async () => {
    mockFetchOnce({ ok: true, body: RAW_BODY });

    const result = await fetchExDividendCalendar("2026-09");

    expect(result.entries[0]?.symbol).toBe("00939");
    expect(result.entries[0]?.companyName).toBeNull();
  });

  // status/paymentDate/fiscalYear (2026-09-22): a field-by-field normalizer silently drops fields it
  // doesn't know about, so this guards the pass-through of all three for both statuses.
  it("passes through status, and paymentDate/fiscalYear only populated on realized rows", async () => {
    mockFetchOnce({ ok: true, body: RAW_BODY });

    const result = await fetchExDividendCalendar("2026-09");

    expect(result.entries[0]).toMatchObject({ status: "announced", paymentDate: null, fiscalYear: null });
    expect(result.entries[1]).toMatchObject({ status: "realized", paymentDate: "2026-08-28", fiscalYear: 2025 });
  });

  // 2026-10-08 起回應裡沒見過的 enum 值照樣放行（passThroughEnum，對 analysis-ts 的承諾），缺欄位才是 502。
  it("passes an unrecognized status through; a missing one is a 502", async () => {
    mockFetchOnce({ ok: true, body: { entries: [{ ...RAW_BODY.entries[0], status: "pending" }] } });
    await expect(fetchExDividendCalendar("2026-09")).resolves.toMatchObject({ entries: [{ status: "pending" }] });

    const { status: _s, ...withoutStatus } = RAW_BODY.entries[0] as Record<string, unknown>;
    mockFetchOnce({ ok: true, body: { entries: [withoutStatus] } });
    await expect(fetchExDividendCalendar("2026-09")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("returns an empty entries array for a month with no data, without throwing", async () => {
    mockFetchOnce({ ok: true, body: { entries: [] } });

    await expect(fetchExDividendCalendar("2099-01")).resolves.toEqual({ entries: [] });
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchExDividendCalendar("2026-09")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError for a non-2xx status", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchExDividendCalendar("2026-09")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response is missing an entries array", async () => {
    mockFetchOnce({ ok: true, body: {} });

    await expect(fetchExDividendCalendar("2026-09")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("passes an unrecognized exType through", async () => {
    mockFetchOnce({ ok: true, body: { entries: [{ ...RAW_BODY.entries[0], exType: "not-a-real-type" }] } });

    await expect(fetchExDividendCalendar("2026-09")).resolves.toMatchObject({ entries: [{ exType: "not-a-real-type" }] });
  });
});

/**
 * 上游 2026-09-23 加了 securityType/recordDate/distributionPerUnit/composition，bff-ts 到 2026-09-30 才接上
 * ——中間一週 ETF 列在我們這一層一個金額都沒有（ETF 的 cashDividend 一律是 null），而且不會有任何錯誤。
 * 這是逐欄位 normalizer 的固定代價，所以這裡守的是**那四個欄位真的穿過這一層**，尤其是 0 不能被當成缺值。
 *
 * 用的是實際回應（00939 統一台灣高息動能 2026-09-01，與 2026-10-05 的 announced 列）。
 */
const RAW_ETF_ROW = {
  symbol: "00939",
  companyName: "統一台灣高息動能",
  status: "realized",
  paymentDate: "2026-09-23",
  fiscalYear: null,
  exDate: "2026-09-01",
  exType: "息",
  cashDividend: null,
  stockDividendRatio: null,
  subscriptionRatio: null,
  subscriptionPricePerShare: null,
  sharesOffered: null,
  sharesEmpOwner: null,
  sharesholderOwner: null,
  stockHoldingRatio: null,
  securityType: "ETF",
  recordDate: "2026-09-07",
  distributionPerUnit: 0.125,
  composition: { dividendIncomePct: 42.4, interestIncomePct: 0, incomeEqualizationPct: 0, realizedCapitalGainPct: 57.6, otherIncomePct: 0 },
};

describe("fetchExDividendCalendar ETF 欄位", () => {
  it("四個 ETF 欄位一路帶到回應", async () => {
    mockFetchOnce({ ok: true, body: { entries: [RAW_ETF_ROW] } });
    const entry = (await fetchExDividendCalendar("2026-09")).entries[0];

    expect(entry?.securityType).toBe("ETF");
    expect(entry?.recordDate).toBe("2026-09-07");
    expect(entry?.distributionPerUnit).toBe(0.125);
    expect(entry?.composition?.dividendIncomePct).toBe(42.4);
  });

  /**
   * **這一條是重點。** 0 是「揭露了而且是零」，null 是「未揭露」；把 0 正規化成 null 會把「這次配息沒有動用
   * 收益平準金」講成「不知道」，而收益平準金佔比正是這個市場最在意的一件事。實測 96 筆 ETF 有 90 筆的
   * incomeEqualizationPct 是 0，所以這是常態不是邊角。
   */
  it("composition 裡的 0 保留成 0，不變成 null", async () => {
    mockFetchOnce({ ok: true, body: { entries: [RAW_ETF_ROW] } });
    const c = (await fetchExDividendCalendar("2026-09")).entries[0]?.composition;

    expect(c?.incomeEqualizationPct).toBe(0);
    expect(c?.incomeEqualizationPct).not.toBeNull();
    expect(c?.interestIncomePct).toBe(0);
    expect(c?.otherIncomePct).toBe(0);
  });

  it("composition 五項全 null 時每一項都是 null，不是 0", async () => {
    const allNull = { dividendIncomePct: null, interestIncomePct: null, incomeEqualizationPct: null, realizedCapitalGainPct: null, otherIncomePct: null };
    mockFetchOnce({ ok: true, body: { entries: [{ ...RAW_ETF_ROW, symbol: "00406A", composition: allNull }] } });
    const c = (await fetchExDividendCalendar("2026-09")).entries[0]?.composition;

    expect(c).not.toBeNull();
    for (const v of Object.values(c ?? {})) {
      expect(v).toBeNull();
    }
  });

  /**
   * 加總不等於 100 的列不得被當成異常攔掉。**兩種量級都要過**：00404A 只揭露 31.67%（真的沒揭露），
   * 00962 是 100.01（四捨五入）。第一次量的時候我用 `abs(sum-100) > 0.01` 當判準，剛好把 100.01 那一類
   * 藏起來，於是對外講了「被動型全部加總 100」這個錯的結論——挑容忍值就是在挑要不要看見某一類資料。
   */
  it("composition 加總不到 100 時照原樣帶出", async () => {
    const partial = { dividendIncomePct: 28.61, interestIncomePct: 0, incomeEqualizationPct: 3.06, realizedCapitalGainPct: 0, otherIncomePct: 0 };
    mockFetchOnce({ ok: true, body: { entries: [{ ...RAW_ETF_ROW, symbol: "00404A", composition: partial }] } });
    const c = (await fetchExDividendCalendar("2026-09")).entries[0]?.composition;

    expect(c?.dividendIncomePct).toBe(28.61);
    expect(c?.incomeEqualizationPct).toBe(3.06);
  });

  it("composition 加總 100.01（四捨五入）時照原樣帶出", async () => {
    const over = { dividendIncomePct: 63.64, interestIncomePct: 0, incomeEqualizationPct: 36.37, realizedCapitalGainPct: 0, otherIncomePct: 0 };
    mockFetchOnce({ ok: true, body: { entries: [{ ...RAW_ETF_ROW, symbol: "00962", composition: over }] } });
    const c = (await fetchExDividendCalendar("2026-09")).entries[0]?.composition;

    expect((c?.dividendIncomePct ?? 0) + (c?.incomeEqualizationPct ?? 0)).toBeCloseTo(100.01, 10);
    expect(c?.dividendIncomePct).toBe(63.64);
  });

  /** COMMON 列四個欄位都是 null（實測 110/110），而 securityType 本身仍要帶出來供下游判斷。 */
  it("COMMON 列的三個 ETF 欄位是 null，securityType 仍帶出", async () => {
    const common = { ...RAW_ETF_ROW, symbol: "2330", companyName: "台積電", securityType: "COMMON", recordDate: null, distributionPerUnit: null, composition: null, cashDividend: 22 };
    mockFetchOnce({ ok: true, body: { entries: [common] } });
    const entry = (await fetchExDividendCalendar("2026-09")).entries[0];

    expect(entry?.securityType).toBe("COMMON");
    expect(entry?.recordDate).toBeNull();
    expect(entry?.distributionPerUnit).toBeNull();
    expect(entry?.composition).toBeNull();
    expect(entry?.cashDividend).toBe(22);
  });

  /**
   * announced 列現在是金額 null、composition 整個 null——上游 2026-09-30 起在金額未公布的 ETF 列一律回 null，
   * 因為 sitca 確認 FundClear 的預告列放的是**上一次**配息的組成（不是預測）。實測 2026-06~10 的 410 筆 ETF，
   * 沒有一筆是「金額未公布但仍有組成」。
   *
   * 這裡仍然驗「原樣轉發」而不是「bff-ts 自己判斷」：如果上游哪天又送來有值的組成，我們照送、不擅自清掉
   * （代理端點零轉換），由文件告知下游怎麼讀。
   */
  it("金額未公布的列 composition 是 null，且照上游原樣轉發", async () => {
    const announced = { ...RAW_ETF_ROW, status: "announced", exDate: "2026-10-05", paymentDate: null, recordDate: "2026-10-11", distributionPerUnit: null, composition: null };
    mockFetchOnce({ ok: true, body: { entries: [announced] } });
    const entry = (await fetchExDividendCalendar("2026-09")).entries[0];

    expect(entry?.distributionPerUnit).toBeNull();
    expect(entry?.composition).toBeNull();
  });

  /**
   * **第三種狀態，也是最容易被 `if (composition)` 漏掉的那一種**：金額公布了（dpu 有值、status realized）
   * 但組成還沒公告，物件存在而五項全 null。00406A 主動中信台灣收益兩次配息都是這樣，不是暫態。
   * 這一條守的是 bff-ts 不把這種物件整個塌成 null——那會讓下游分不出「沒有組成」與「組成還沒公告」。
   */
  it("金額有值但組成未公告時保留物件、五項皆 null", async () => {
    const allNull = { dividendIncomePct: null, interestIncomePct: null, incomeEqualizationPct: null, realizedCapitalGainPct: null, otherIncomePct: null };
    const row = { ...RAW_ETF_ROW, symbol: "00406A", companyName: "主動中信台灣收益", distributionPerUnit: 0.138, composition: allNull };
    mockFetchOnce({ ok: true, body: { entries: [row] } });
    const entry = (await fetchExDividendCalendar("2026-09")).entries[0];

    expect(entry?.distributionPerUnit).toBe(0.138);
    expect(entry?.composition).not.toBeNull();
    expect(entry?.composition?.dividendIncomePct).toBeNull();
  });

  /** 沒見過的 securityType 照樣放行（2026-10-08 以前是變成 null）、不丟 502，上游多一種類型不該讓整個月的行事曆掛掉。 */
  it("沒見過的 securityType 原樣放行而不是丟 502", async () => {
    mockFetchOnce({ ok: true, body: { entries: [{ ...RAW_ETF_ROW, securityType: "LEVERAGED" }] } });
    const entry = (await fetchExDividendCalendar("2026-09")).entries[0];

    expect(entry?.securityType).toBe("LEVERAGED");
    expect(entry?.distributionPerUnit).toBe(0.125);
  });

  /** 欄位整個缺席時（版本錯開）不炸、給 null——這幾個欄位不像股利來源那樣是「保證存在」的。 */
  it("上游沒有這四個欄位時回 null 而不是丟錯", async () => {
    const { securityType: _s, recordDate: _r, distributionPerUnit: _d, composition: _c, ...bare } = RAW_ETF_ROW;
    mockFetchOnce({ ok: true, body: { entries: [bare] } });
    const entry = (await fetchExDividendCalendar("2026-09")).entries[0];

    expect(entry?.securityType).toBeNull();
    expect(entry?.recordDate).toBeNull();
    expect(entry?.distributionPerUnit).toBeNull();
    expect(entry?.composition).toBeNull();
  });
});
