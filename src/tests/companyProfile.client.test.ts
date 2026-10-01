import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCompanyProfile } from "@/infrastructure/analysisApi/stock/companyProfile.client.js";

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

const RAW_PROFILE = {
  symbol: "2330",
  market: "TWSE",
  reportDate: "2026-08-29",
  name: "台灣積體電路製造股份有限公司",
  shortName: "台積電",
  foreignRegistrationCountry: null,
  industry: "24",
  industryName: "半導體業",
  address: "新竹科學園區力行六路8號",
  taxId: "22099131",
  chairman: "魏哲家",
  generalManager: "總裁: 魏哲家",
  spokesperson: "黃仁昭",
  spokespersonTitle: "資深副總經理暨財務長",
  deputySpokesperson: "高孟華",
  phone: "03-5636688",
  establishedDate: "1987-02-21",
  listedDate: "1994-09-05",
  parValue: 10,
  paidInCapital: "259323700670",
  privatePlacementShares: "0",
  preferredStockShares: "0",
  // financialReportType "1" = 合併 (exchange code), metricDataType "2" = 合併 (MOPS dataType) — opposite
  // numbering, both correct for 2330. Label corrected by analysis-ts 2026-09-22 (was "個別財報").
  financialReportType: "1",
  financialReportTypeName: "合併財報",
  metricDataType: "2",
  stockTransferAgency: "中國信託商業銀行 代理部",
  transferAgencyPhone: "02-6636-5566",
  transferAgencyAddress: "台北市重慶南路一段83號5樓",
  auditingFirm: "勤業眾信聯合會計師事務所",
  auditor1: "吳世宗",
  auditor2: "陳彥君",
  englishShortName: "TSMC",
  englishAddress: "No. 8, Li-Hsin Rd. 6, Hsinchu Science Park,Hsin-Chu 300096, Taiwan, R.O.C.",
  faxNumber: "03-5797337",
  email: "invest@tsmc.com",
  website: "https://www.tsmc.com",
  issuedShares: "25932370067",
};

describe("fetchCompanyProfile", () => {
  it("requests /companies/profile?symbol= and normalizes parValue to a string", async () => {
    mockFetchOnce({ ok: true, body: RAW_PROFILE });

    const result = await fetchCompanyProfile("2330");

    // RAW_PROFILE 是上游加 isEmerging 之前的樣本，刻意保留當時的形狀——這一層補 null，正好也是
    // 「上游沒送這個欄位時給 null 而不是 false」那條規則的驗證。
    expect(result).toEqual({ ...RAW_PROFILE, parValue: "10", isEmerging: null });
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/companies/profile?symbol=2330");
  });

  it("returns null on a 404 (checked TWSE then TPEx, neither had it) instead of throwing", async () => {
    mockFetchOnce({ ok: false, status: 404, body: {} });

    await expect(fetchCompanyProfile("nope")).resolves.toBeNull();
  });

  // TPEx has no englishAddress or industryName field at all on its source side — always null there, not
  // a query failure. industryName is null on TPEx pending tpex-ts (analysis-ts won't guess a code table).
  it("keeps englishAddress and industryName null for a TPEx company", async () => {
    mockFetchOnce({
      ok: true,
      body: { ...RAW_PROFILE, market: "TPEx", englishAddress: null, industryName: null },
    });

    const result = await fetchCompanyProfile("8299");

    expect(result?.market).toBe("TPEx");
    expect(result?.englishAddress).toBeNull();
    expect(result?.industryName).toBeNull();
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchCompanyProfile("2330")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError for a non-404 non-2xx status", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchCompanyProfile("2330")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response is missing symbol", async () => {
    mockFetchOnce({ ok: true, body: { name: "台積電" } });

    await expect(fetchCompanyProfile("2330")).rejects.toMatchObject({ statusCode: 502 });
  });

  // metricDataType (2026-09-22) is a required two-value enum upstream — an individual-only filer is "1".
  it("passes through metricDataType '1' for an individual-statement-only filer", async () => {
    mockFetchOnce({ ok: true, body: { ...RAW_PROFILE, symbol: "2816", financialReportType: "2", financialReportTypeName: "個別財報", metricDataType: "1" } });

    const result = await fetchCompanyProfile("2816");

    expect(result?.metricDataType).toBe("1");
  });

  it("throws a 502 AppError when metricDataType is missing or not '1'/'2'", async () => {
    mockFetchOnce({ ok: true, body: { ...RAW_PROFILE, metricDataType: "3" } });

    await expect(fetchCompanyProfile("2330")).rejects.toMatchObject({ statusCode: 502 });
  });
});

/**
 * `isEmerging`（上游 2026-10-01 新增）是 per-symbol 層級唯一能區分興櫃的欄位。這裡守的是**缺席時給 null
 * 而不是 false**：上游正式環境還沒部署這個欄位，而把興櫃說成「不是興櫃」是一個錯的標籤——比缺一個標籤糟，
 * 因為下游會據此宣稱「這家公司有單季資料」而實際上永久沒有。
 */
describe("fetchCompanyProfile 的 isEmerging", () => {
  it("true／false 都原樣帶出", async () => {
    mockFetchOnce({ ok: true, body: { ...RAW_PROFILE, symbol: "1293", market: "TPEx", isEmerging: true } });
    expect((await fetchCompanyProfile("1293"))?.isEmerging).toBe(true);

    mockFetchOnce({ ok: true, body: { ...RAW_PROFILE, symbol: "8050", market: "TPEx", isEmerging: false } });
    expect((await fetchCompanyProfile("8050"))?.isEmerging).toBe(false);
  });

  it("上游沒送時是 null，不是 false", async () => {
    mockFetchOnce({ ok: true, body: RAW_PROFILE });
    expect((await fetchCompanyProfile("2330"))?.isEmerging).toBeNull();
  });

  /** 非布林值（例如上游誤送字串）也當成「不知道」，不要用 truthy 判斷——"false" 會變成 true。 */
  it("非布林值當成 null", async () => {
    mockFetchOnce({ ok: true, body: { ...RAW_PROFILE, isEmerging: "false" } });
    expect((await fetchCompanyProfile("2330"))?.isEmerging).toBeNull();
  });
});
