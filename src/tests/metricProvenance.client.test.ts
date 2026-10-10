import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMetricProvenance } from "@/infrastructure/analysisApi/stock/metricProvenance.client.js";

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

    // ROE_BODY 是 2026-09-15 拿到的真實回應，刻意保留當時的形狀。上游 2026-10-01 新增的 periodType
    // 不在那份樣本裡，所以這一層補 null——其餘欄位仍是逐字 deep-equal，形狀再變這條還是會亮。
    expect(result).toEqual({ ...ROE_BODY, timeframe: null });
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/companies/2330/metric-provenance?metricCode=roe");
  });

  it("sends fiscalYear/fiscalQuarter (Western year, int) when both are given", async () => {
    mockFetchOnce({ ok: true, body: ROE_BODY });

    await fetchMetricProvenance("2330", "roe", 2026, 2);

    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/companies/2330/metric-provenance?metricCode=roe&fiscalYear=2026&fiscalQuarter=2");
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

    await expect(fetchMetricProvenance("9999999", "roe")).resolves.toEqual({ ...NOT_FOUND_BODY, timeframe: null });
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

  // Regression coverage for 2026-09-15: bff-ts used to hardcode the allowed metricCode set and never
  // even called analysis-ts for anything outside it (caught when hasProvenance already listed 112
  // metricCodes but this endpoint only accepted 6). Validation is now analysis-ts's own — confirmed live
  // its 400 is a nested zod error tree, not the flat {message} shape most other clients relay, so the
  // useful detail (the actual supported-metricCode list) must be dug out of errors.metricCode._errors.
  it("relays analysis-ts's nested 400 field error for an unsupported metricCode", async () => {
    mockFetchOnce({
      ok: false,
      status: 400,
      body: {
        message: "Invalid query parameters.",
        errors: {
          _errors: [],
          metricCode: { _errors: ['metricCode is required, 目前僅支援 sue/chowderNumber/roe。'] },
        },
      },
    });

    await expect(fetchMetricProvenance("2330", "totallyBogusMetric")).rejects.toMatchObject({
      statusCode: 400,
      message: "metricCode is required, 目前僅支援 sue/chowderNumber/roe。",
    });
  });

  it("falls back to the top-level message when there's no nested metricCode field error", async () => {
    mockFetchOnce({ ok: false, status: 400, body: { message: "Some other validation error." } });

    await expect(fetchMetricProvenance("2330", "roe")).rejects.toMatchObject({
      statusCode: 400,
      message: "Some other validation error.",
    });
  });
});

/**
 * 上游 2026-10-01 同時新增了 query 參數 `periodType`／`asOfDate` 與回應欄位 `periodType`。**沒轉發參數的後果
 * 不是「沒有效果」，是回 200 加一個錯的答案**（實測：periodType=Q 時上游回 found:false，沒轉發時回
 * found:true 加 TTM 的值；asOfDate 沒轉發時回最新值而不是指定日的值），而漏接回應欄位會把唯一的偵測器
 * 拿掉。所以這裡守的是**參數真的出現在送往上游的 URL 上**，以及那個欄位真的穿過 normalizer。
 *
 * 這一組是 mock 測試，驗的是「我們送出什麼」而不是「上游怎麼回應」——後者只能實打，見
 * roeRoaHistory.client.test.ts 裡那條被刪掉的 Q_ANN 測試的教訓。
 */
describe("fetchMetricProvenance 的新參數與新欄位", () => {
  const sentUrl = () => String(vi.mocked(globalThis.fetch).mock.calls[0]?.[0] ?? "");

  it("timeframe 與 asOfDate 都會出現在送往上游的 URL 上（上游 05967082 起叫 timeframe）", async () => {
    mockFetchOnce({ ok: true, body: ROE_BODY });
    await fetchMetricProvenance("2330", "roe", undefined, undefined, "FY", "2026-08-01");

    expect(sentUrl()).toContain("timeframe=FY");
    expect(sentUrl()).not.toContain("periodType");
    expect(sentUrl()).toContain("asOfDate=2026-08-01");
  });

  /** 省略時**不得**送出空字串——那會把「不限定」變成「指定一個空值」，上游的語意完全不同。 */
  it("省略時完全不出現在 URL 上", async () => {
    mockFetchOnce({ ok: true, body: ROE_BODY });
    await fetchMetricProvenance("2330", "roe");

    expect(sentUrl()).not.toContain("timeframe");
    expect(sentUrl()).not.toContain("asOfDate");
  });

  it("回應的 timeframe 穿過 normalizer", async () => {
    mockFetchOnce({ ok: true, body: { ...ROE_BODY, timeframe: "TTM" } });
    const result = await fetchMetricProvenance("2330", "roe");

    expect(result.timeframe).toBe("TTM");
  });

  /** 逐日與月頻指標的 periodType 是 null，而上游沒送這個欄位時也必須是 null、不能是 undefined。 */
  it("上游沒給 periodType 或給 null 時為 null", async () => {
    mockFetchOnce({ ok: true, body: { ...ROE_BODY, periodType: null } });
    expect((await fetchMetricProvenance("2330", "roe")).timeframe).toBeNull();

    const { periodType: _omitted, ...withoutField } = { ...ROE_BODY, periodType: "TTM" };
    mockFetchOnce({ ok: true, body: withoutField });
    expect((await fetchMetricProvenance("2330", "roe")).timeframe).toBeNull();
  });

  /**
   * 上游在要求的期別不存在時回 found:false 加說明，**這一層必須原樣帶出**——把它變成 found:true 是
   * 2026-10-01 當天的實際狀態，也是這組測試存在的理由。
   */
  it("上游回 found:false 時原樣帶出，不改成 true", async () => {
    mockFetchOnce({
      ok: true,
      body: { ...ROE_BODY, found: false, value: null, entries: [], periodType: "TTM", methodologyNote: "這支指標的溯源表目前只提供 TTM（要求的是 Q）。" },
    });
    const result = await fetchMetricProvenance("2330", "roe", undefined, undefined, "Q");

    expect(result.found).toBe(false);
    expect(result.value).toBeNull();
    expect(result.timeframe).toBe("TTM");
    expect(result.methodologyNote).toContain("只提供 TTM");
  });
});
