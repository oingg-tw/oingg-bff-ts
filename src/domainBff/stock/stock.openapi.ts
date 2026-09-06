import { z } from "zod";
import { errorResponse, registry } from "@/adapters/swagger/registry.js";
import { financialStatementQuerySchema, preferredStocksQuerySchema } from "@/domainBff/stock/stock.routes.js";

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

const financialStatementSchema = z
  .object({
    symbol: z.string(),
    statementType: z.enum(["balanceSheet", "incomeStatement", "cashFlowStatement"]),
    dataType: z.string().nullable(),
    subsidiaryCompanyId: z.string().nullable(),
    year: z.string().nullable(),
    season: z.string().nullable(),
    reportDate: z.string().nullable(),
    found: z.boolean(),
    statement: z.record(z.string(), z.string().nullable()).nullable(),
  })
  .openapi("FinancialStatement", {
    example: {
      symbol: "2330",
      statementType: "balanceSheet",
      dataType: "2",
      subsidiaryCompanyId: "",
      year: "115",
      season: "2",
      reportDate: "2026-06-30",
      found: true,
      statement: {
        cashAndEquivalents: "3134218213",
        accountsReceivable: "435762477",
        inventory: "385524542",
        currentAssets: "4565700742",
        totalAssets: "9375654727",
        shortTermBorrowings: null,
        totalLiabilities: "2901183746",
        totalEquity: "6474470981",
        totalLiabilitiesAndEquity: "9375654727",
      },
    },
  });

registry.registerPath({
  method: "get",
  path: "/stocks/{symbol}/financial-statement",
  summary: "查詢一季完整的財報原始科目金額（會計模式用，非比率指標）",
  description:
    "資料來自 oingg-analysis-ts 的 GET /companies/financial-statement。三種 statementType 各自的科目欄位不同（balanceSheet/incomeStatement/cashFlowStatement），欄位為 camelCase，金額一律序列化成字串（bigint 避免精度問題），incomeStatement 的 eps/epsDiluted 原始資料就是字串（非序列化所致）。欄位值為 null 代表財報本來就沒揭露該科目或為零，不代表查詢失敗。不給 year/season 會查最新一季；查無資料（代號不存在，或指定的 year/season 沒有申報資料）回應 found:false、statement:null，仍是 200，不是 404。dataType/subsidiaryCompanyId 是 analysis-ts 內部欄位原樣轉發，語意未正式核對過。",
  tags: ["Stock"],
  request: {
    params: symbolParam,
    query: financialStatementQuerySchema.openapi("FinancialStatementQuery", {
      example: { statementType: "balanceSheet", year: "115", season: "2" },
    }),
  },
  responses: {
    200: {
      description: "一季財報原始科目金額，查無資料時 found 為 false、statement 為 null。",
      content: { "application/json": { schema: financialStatementSchema } },
    },
    400: errorResponse('"statementType" 缺少或無效，或 year/season 只給了其中一個。'),
    502: unauthorized502,
  },
});

const preferredStockEntrySchema = z
  .object({
    symbol: z.string(),
    name: z.string(),
    isinCode: z.string(),
    listedDate: z.string(),
    marketType: z.string(),
    issueDate: z.string(),
    issuePrice: z.number(),
    dividendRate: z.number(),
    nominalDividendRatePct: z.number(),
    currentYieldPct: z.number().nullable(),
    latestClosePrice: z.number().nullable(),
    latestPriceDate: z.string().nullable(),
    cumulativeDividend: z.boolean(),
    participatingExcessDividend: z.boolean(),
    liquidationPreference: z.boolean(),
    votingRights: z.boolean(),
    convertible: z.boolean(),
    conversionStartDate: z.string().nullable(),
    redeemable: z.boolean(),
    redemptionDate: z.string().nullable(),
    redemptionConditions: z.string().nullable(),
  })
  .openapi("PreferredStockEntry", {
    example: {
      symbol: "1101B",
      name: "台泥乙特",
      isinCode: "TW0001101B05",
      listedDate: "2019-01-29",
      marketType: "上市",
      issueDate: "2018-12-13",
      issuePrice: 50,
      dividendRate: 1.75,
      nominalDividendRatePct: 3.5,
      currentYieldPct: 4.03,
      latestClosePrice: 43.45,
      latestPriceDate: "2026-09-04",
      cumulativeDividend: false,
      participatingExcessDividend: false,
      liquidationPreference: true,
      votingRights: false,
      convertible: false,
      conversionStartDate: null,
      redeemable: true,
      redemptionDate: "2023-12-13",
      redemptionConditions: "本公司得於發行日滿五年後之次日起按實際發行價格收回",
    },
  });

registry.registerPath({
  method: "get",
  path: "/stocks/preferred-stocks",
  summary: "查詢特別股清單（僅上市，上櫃無對應資料源）",
  description:
    "資料來自 oingg-analysis-ts 的 GET /preferred-stocks。不給 symbol 回傳目前所有上市特別股（截至 2026-09-06 共 28 檔）；給 symbol 查無資料回傳空陣列，不是 404。dividendRate 是每股固定配息金額（新台幣元），不是百分比——不要跟 nominalDividendRatePct（票面利率，發行時基準、之後不變）或 currentYieldPct（目前殖利率，隨股價每天變動，查無股價時為 null）搞混，三者是不同概念。redeemable/redemptionDate/redemptionConditions 是「公司贖回權」（公司可要求收回），不是「投資人賣回權」——這支端點沒有投資人賣回權的對應欄位。",
  tags: ["Stock"],
  request: {
    query: preferredStocksQuerySchema.openapi("PreferredStocksQuery", { example: { symbol: "1101B" } }),
  },
  responses: {
    200: {
      description: "特別股清單，查無資料時 entries 為空陣列。",
      content: {
        "application/json": {
          schema: z.object({ entries: z.array(preferredStockEntrySchema) }).openapi("PreferredStocks"),
        },
      },
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
