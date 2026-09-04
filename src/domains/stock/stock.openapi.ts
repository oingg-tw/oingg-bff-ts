import { z } from "zod";
import { errorResponse, registry } from "@/adapters/swagger/registry.js";

const symbolParam = z.object({ symbol: z.string().openapi({ example: "2330", description: "股票代號" }) });
const unauthorized502 = errorResponse("analysis-ts 服務無法連線或回應格式異常。");

const stockQuoteSchema = z
  .object({
    symbol: z.string(),
    price: z.object({ tradeDate: z.string(), close: z.string().nullable() }).nullable(),
    valuation: z
      .object({
        tradeDate: z.string(),
        peRatio: z.string().nullable(),
        pbRatio: z.string().nullable(),
        dividendYield: z.string().nullable(),
      })
      .nullable(),
  })
  .openapi("StockQuote");

registry.registerPath({
  method: "get",
  path: "/stocks/{symbol}",
  summary: "查詢股票的最新股價、本益比、本淨比、殖利率",
  description: "資料來自 oingg-analysis-ts（不分上市/上櫃，由它內部判斷查哪個市場）。",
  tags: ["Stock"],
  request: { params: symbolParam },
  responses: {
    200: {
      description: "股價/估值資料，任一邊查無資料時對應欄位為 null。",
      content: { "application/json": { schema: stockQuoteSchema } },
    },
    404: errorResponse("上市、上櫃都查無此股票代號的任何資料。"),
    502: unauthorized502,
  },
});

const companyProfileSchema = z
  .object({
    symbol: z.string(),
    market: z.enum(["TWSE", "TPEx"]),
    reportDate: z.string(),
    name: z.string(),
    shortName: z.string(),
    foreignRegistrationCountry: z.string().nullable(),
    industry: z.string().nullable(),
    industryName: z.string().nullable(),
    address: z.string().nullable(),
    taxId: z.string().nullable(),
    chairman: z.string().nullable(),
    generalManager: z.string().nullable(),
    spokesperson: z.string().nullable(),
    spokespersonTitle: z.string().nullable(),
    deputySpokesperson: z.string().nullable(),
    phone: z.string().nullable(),
    establishedDate: z.string().nullable(),
    listedDate: z.string().nullable(),
    parValue: z.string().nullable(),
    paidInCapital: z.string().nullable(),
    privatePlacementShares: z.string().nullable(),
    preferredStockShares: z.string().nullable(),
    financialReportType: z.string().nullable(),
    financialReportTypeName: z.string().nullable(),
    stockTransferAgency: z.string().nullable(),
    transferAgencyPhone: z.string().nullable(),
    transferAgencyAddress: z.string().nullable(),
    auditingFirm: z.string().nullable(),
    auditor1: z.string().nullable(),
    auditor2: z.string().nullable(),
    englishShortName: z.string().nullable(),
    englishAddress: z.string().nullable(),
    faxNumber: z.string().nullable(),
    email: z.string().nullable(),
    website: z.string().nullable(),
    issuedShares: z.string().nullable(),
  })
  .openapi("CompanyProfile", {
    example: {
      symbol: "2330",
      market: "TWSE",
      reportDate: "2026-08-29",
      name: "台灣積體電路製造股份有限公司",
      shortName: "台積電",
      foreignRegistrationCountry: null,
      industry: "24",
      industryName: "半導體業",
      address: null,
      taxId: null,
      chairman: "魏哲家",
      generalManager: "總裁: 魏哲家",
      spokesperson: "黃仁昭",
      spokespersonTitle: "資深副總經理暨財務長",
      deputySpokesperson: null,
      phone: null,
      establishedDate: "1987-02-21",
      listedDate: "1994-09-05",
      parValue: "10",
      paidInCapital: "259323700670",
      privatePlacementShares: null,
      preferredStockShares: null,
      financialReportType: "1",
      financialReportTypeName: "個別財報",
      stockTransferAgency: null,
      transferAgencyPhone: null,
      transferAgencyAddress: null,
      auditingFirm: null,
      auditor1: null,
      auditor2: null,
      englishShortName: "TSMC",
      englishAddress: null,
      faxNumber: null,
      email: null,
      website: "https://www.tsmc.com",
      issuedShares: "25932370067",
    },
  });

registry.registerPath({
  method: "get",
  path: "/stocks/{symbol}/profile",
  summary: "查詢公司基本資料（董事長、發言人、實收資本額、簽證會計師等）",
  description:
    "資料來自 oingg-analysis-ts 的 GET /companies/profile（上市查無資料才查上櫃）。不篩選 ETF／KY／興櫃身分——指名查哪支代號就照實回傳那家公司的資料。TPEx 沒有 englishAddress、industryName 欄位，一律是 null（不是查詢失敗，是 TPEx 資料源本來就沒有）。",
  tags: ["Stock"],
  request: { params: symbolParam },
  responses: {
    200: { description: "公司基本資料。", content: { "application/json": { schema: companyProfileSchema } } },
    404: errorResponse("上市、上櫃都查無此股票代號的公司基本資料。"),
    502: unauthorized502,
  },
});

const changeSourceSchema = z.object({
  cashIncrease: z.string().nullable(),
  capitalReserveTransfer: z.string().nullable(),
  retainedEarningsTransfer: z.string().nullable(),
  mergerIncrease: z.string().nullable(),
  capitalReduction: z.string().nullable(),
  other: z.string().nullable(),
});

const capitalStockHistorySchema = z
  .object({
    symbol: z.string(),
    entries: z.array(
      z.object({
        effectiveDate: z.string(),
        paidInShares: z.string(),
        paidInCapital: z.string(),
        changeSource: changeSourceSchema,
        remarks: z.string().nullable(),
        sharesChangePercent: z.number().nullable(),
      }),
    ),
  })
  .openapi("CapitalStockHistory");

registry.registerPath({
  method: "get",
  path: "/stocks/{symbol}/capital-stock-history",
  summary: "查詢股本歷史（實收股本/股數變動，含現金增資、公積/盈餘轉增資、合併增資、減資等來源拆解）",
  description:
    "資料來自 oingg-analysis-ts 的 GET /companies/capital-stock-history。entries 由新到舊排序；changeSource 底下 5 個金額欄位固定同時存在（不相關的來源是 \"0\" 而非缺席），可能同時多個來源非零（約 9% 的資料如此），capitalReduction 可能是負數，不要取絕對值。sharesChangePercent 是跟「時間序上更早」那筆比較的流通股數變動百分比——因為 entries 是新到舊排序，「更早」指的是陣列裡的下一筆（index+1），不是上一筆；最舊一筆没有更早的可比較，是 null。查無資料回傳空陣列，不是 404。",
  tags: ["Stock"],
  request: { params: symbolParam },
  responses: {
    200: {
      description: "股本歷史，查無資料時 entries 為空陣列。",
      content: { "application/json": { schema: capitalStockHistorySchema } },
    },
    502: unauthorized502,
  },
});

const exDividendNoticeEntrySchema = z.object({
  exDate: z.string(),
  exType: z.enum(["息", "權", "權息"]),
  stockDividendRatio: z.number().nullable(),
  subscriptionRatio: z.number().nullable(),
  subscriptionPricePerShare: z.number().nullable(),
  cashDividend: z.number().nullable(),
  sharesOffered: z.number().nullable(),
  sharesEmpOwner: z.number().nullable(),
  sharesholderOwner: z.number().nullable(),
  stockHoldingRatio: z.number().nullable(),
});

registry.registerPath({
  method: "get",
  path: "/stocks/ex-dividend-notices",
  summary: "批次查詢即將除息/除權的公告",
  description:
    "資料來自 oingg-analysis-ts 的 GET /stocks/ex-dividend-notices。symbols 逗號分隔，一次最多 100 檔（超過回 400）。查無未來除權息公告的代號不會出現在 notices 裡（不是空陣列）。同一代號的陣列已依 exDate 由近到遠排序。exType「權」底下有兩種互斥欄位組合：股票股利/盈餘轉增資用 stockDividendRatio；現金增資認股用 subscriptionRatio/subscriptionPricePerShare/sharesOffered/sharesEmpOwner/sharesholderOwner/stockHoldingRatio，不會同時出現。純「息」只有 cashDividend 非 null。sharesOffered 等 4 個現金增資欄位的語意是 analysis-ts 依欄位命名推測，未跟 twse-ts 正式核對過。",
  tags: ["Stock"],
  request: {
    query: z.object({
      symbols: z.string().openapi({ example: "2330,00939", description: "逗號分隔的股票代號，最多 100 檔" }),
    }),
  },
  responses: {
    200: {
      description: "除權息公告，key 是股票代號，查無公告的代號不會出現。",
      content: {
        "application/json": {
          schema: z.object({ notices: z.record(z.string(), z.array(exDividendNoticeEntrySchema)) }).openapi("ExDividendNotices"),
        },
      },
    },
    400: errorResponse("缺少 symbols 參數，或超過 100 檔。"),
    502: unauthorized502,
  },
});
