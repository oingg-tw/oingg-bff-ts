import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCompanyProfile } from "@/domains/stock/companyProfile.client.js";

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
  financialReportType: "1",
  financialReportTypeName: "個別財報",
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
  it("requests /companies/profile?companyId= and normalizes parValue to a string", async () => {
    mockFetchOnce({ ok: true, body: RAW_PROFILE });

    const result = await fetchCompanyProfile("2330");

    expect(result).toEqual({ ...RAW_PROFILE, parValue: "10" });
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/companies/profile?companyId=2330");
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
});
