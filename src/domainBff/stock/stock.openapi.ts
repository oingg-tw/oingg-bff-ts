import { z } from "zod";
import { errorResponse, registry } from "@/adapters/swagger/registry.js";
import {
  dupontHistoryQuerySchema,
  exDividendCalendarQuerySchema,
  financialStatementQuerySchema,
  foreignShareholdingHistoryQuerySchema,
  metricHistoryQuerySchema,
  metricsHistoryQuerySchema,
  monthlyRevenueHistoryQuerySchema,
  preferredStocksQuerySchema,
  roeRoaHistoryQuerySchema,
} from "@/domainBff/stock/stock.routes.js";

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
    callRiskAmount: z.number().nullable(),
    ytwPct: z.number().nullable(),
    ytcPct: z.number().nullable(),
    ytcAssumption: z
      .enum([
        "scheduled_redemption_date",
        "past_redemption_date_assumed_next_period",
        "no_scheduled_redemption_date_assumed_next_period",
      ])
      .nullable(),
    premiumRatePct: z.number().nullable(),
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
      callRiskAmount: 6.55,
      ytwPct: 4.03,
      ytcPct: 19.1,
      ytcAssumption: "past_redemption_date_assumed_next_period",
      premiumRatePct: -13.1,
    },
  });

registry.registerPath({
  method: "get",
  path: "/stocks/preferred-stocks",
  summary: "查詢特別股清單（僅上市，上櫃無對應資料源）",
  description:
    "資料來自 oingg-analysis-ts 的 GET /preferred-stocks。不給 symbol 回傳目前所有上市特別股（截至 2026-09-06 共 28 檔）；給 symbol 查無資料回傳空陣列，不是 404。dividendRate 是每股固定配息金額（新台幣元），不是百分比——不要跟 nominalDividendRatePct（票面利率，發行時基準、之後不變）或 currentYieldPct（目前殖利率，隨股價每天變動，查無股價時為 null）搞混，三者是不同概念。redeemable/redemptionDate/redemptionConditions 是「公司贖回權」（公司可要求收回），不是「投資人賣回權」——這支端點沒有投資人賣回權的對應欄位。callRiskAmount（買回風險，只在 redeemable 為 true 時才有值）是 analysis-ts 原生提供的欄位（2026-09-06 新增；同時新增的 callProtectionYears 已於同日移除，redemptionDate/redemptionConditions 已足以表達贖回期資訊），原樣轉發，公式為「發行價-現價」：負值代表現價已超過發行價、有被贖回吃虧的風險，正值代表沒有此風險。此端點固定向 analysis-ts 要求較大的 limit（避免其分頁機制截斷「查全部」的用法），本身對外不提供分頁參數，回應固定是 { entries: [...] }。ytwPct（最差殖利率）、ytcPct（贖回殖利率）、ytcAssumption（ytcPct 假設用哪個贖回日：scheduled_redemption_date 是還沒到期的真實贖回日，past_redemption_date_assumed_next_period 是真實贖回日已過、公司還沒行使贖回權時改用下一期估算，no_scheduled_redemption_date_assumed_next_period 是條款本身沒有排定贖回日、同樣改用下一期估算）是 analysis-ts 原生提供的欄位（2026-09-07 新增），原樣轉發，只在 redeemable 為 true 時才有值；ytwPct 例外，即使 redeemable 是 false 也有值（等於 currentYieldPct，因為沒有贖回選擇權時「最差」就是持有到期本身）。premiumRatePct（溢價率，(現價-發行價)/發行價×100，四捨五入到小數點後 2 位）是 analysis-ts 原生提供的欄位（2026-09-08 新增，取代舊的 negativeConvexityWarning 布林值），只在 redeemable 為 true 且現價/發行價都非 null 時才有值，否則為 null（不是 0）。",
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

const preferredStockFieldCatalogEntrySchema = z.object({
  field: z.string(),
  label: z.string(),
  formula: z.string(),
  inputs: z.array(z.string()),
});

registry.registerPath({
  method: "get",
  path: "/stocks/preferred-stocks/field-catalog",
  summary: "特別股衍生欄位的公式/輸入來源說明（premiumRatePct、ytcPct 等）",
  description:
    "資料來自 oingg-analysis-ts 的 GET /preferred-stocks/field-catalog。純靜態文件，不查詢資料庫、不受任何查詢參數影響，同樣的回應每次都一樣（已與 analysis-ts 確認，2026-09-08）。原樣轉發，不加工。目前涵蓋 nominalDividendRatePct、currentYieldPct、premiumRatePct、ytcPct、ytcAssumption、ytwPct 六個欄位的公式與輸入欄位清單。",
  tags: ["Stock"],
  responses: {
    200: {
      description: "衍生欄位公式說明清單。",
      content: {
        "application/json": {
          schema: z
            .object({ fields: z.array(preferredStockFieldCatalogEntrySchema) })
            .openapi("PreferredStockFieldCatalog", {
              example: {
                fields: [
                  {
                    field: "premiumRatePct",
                    label: "溢價率",
                    formula: "(latestClosePrice - issuePrice) / issuePrice * 100，只在 redeemable=true 時才計算",
                    inputs: ["latestClosePrice", "issuePrice", "redeemable"],
                  },
                ],
              },
            }),
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

const exDividendCalendarEntrySchema = exDividendNoticeEntrySchema.extend({
  symbol: z.string(),
  companyName: z.string().nullable(),
});

registry.registerPath({
  method: "get",
  path: "/stocks/ex-dividend-calendar",
  summary: "查詢整月全市場的除息/除權事件（股利行事曆用，不限單一代號）",
  description:
    "資料來自 oingg-analysis-ts 的 GET /stocks/ex-dividend-calendar（2026-09-10 新增）。跟 ex-dividend-notices 的差別：這支是攤平的全市場清單（一次回傳整個月所有代號的事件，不用先知道代號），不是照代號分組，也沒有「只顯示未來事件」的過濾——查歷史月份或未來月份都會照實回傳當月真實發生（或已排定）的事件。month 格式必須是 \"YYYY-MM\"（例如 \"2026-09\"），格式錯誤或缺少會 400。每筆 entry 除了跟 ex-dividend-notices 一樣的欄位（exDate/exType/stockDividendRatio 等）外，多了 symbol 跟 companyName——companyName 可能是 null（ETF 不在 analysis-ts 的公司名稱對照表裡，例如 00939/00984D）。查無資料的月份（例如太久遠或太未來）回傳空陣列，不是錯誤。",
  tags: ["Stock"],
  request: {
    query: exDividendCalendarQuerySchema.openapi("ExDividendCalendarQuery", { example: { month: "2026-09" } }),
  },
  responses: {
    200: {
      description: "整月全市場除權息事件清單，查無資料時 entries 為空陣列。",
      content: {
        "application/json": {
          schema: z.object({ entries: z.array(exDividendCalendarEntrySchema) }).openapi("ExDividendCalendar"),
        },
      },
    },
    400: errorResponse('缺少 month 參數，或格式不是 "YYYY-MM"。'),
    502: unauthorized502,
  },
});

const metricHistoryEntrySchema = z.object({
  fiscalYear: z.number(),
  fiscalQuarter: z.number(),
  value: z.number().nullable(),
  nullReason: z.string().nullable(),
  knowledgeDate: z.string(),
  knowledgeDateIsFallback: z.boolean(),
});

const metricHistorySchema = z
  .object({
    symbol: z.string(),
    metricCode: z.enum(["eps", "peRatio", "pbRatio", "bvps", "stockPrice"]),
    basis: z.enum(["TTM", "Q"]),
    total: z.number(),
    hasMore: z.boolean(),
    entries: z.array(metricHistoryEntrySchema),
  })
  .openapi("MetricHistory", {
    example: {
      symbol: "2330",
      metricCode: "peRatio",
      basis: "TTM",
      total: 23,
      hasMore: false,
      entries: [
        { fiscalYear: 2025, fiscalQuarter: 2, value: 13.55, nullReason: null, knowledgeDate: "2025-08-12", knowledgeDateIsFallback: false },
        { fiscalYear: 2025, fiscalQuarter: 3, value: 15.93, nullReason: null, knowledgeDate: "2025-11-11", knowledgeDateIsFallback: false },
      ],
    },
  });

registry.registerPath({
  method: "get",
  path: "/stocks/{symbol}/metric-history",
  summary: "查詢 EPS/本益比/本淨比的季度歷史數列（個股詳細頁圖表用）",
  description:
    "資料來自 oingg-analysis-ts 的 GET /companies/metric-history——這是 analysis-ts 自己用驗證過的 eps/bvps 公式重新算出來的數字，不是轉發原始 daily_valuation；knowledgeDate 對齊財報公告日，不是逐日更新的市場數據。metricCode 只允許特定的 basis 組合（實測，不是每個都一樣）：eps 可以是 TTM 或 Q，peRatio 只能 TTM，pbRatio 只能 Q，bvps（每股淨值，2026-09-07 加入）只能 Q，stockPrice（財報公告日當天股價，2026-09-07 加入，取代前端用 peRatio×EPS 反推股價的做法）也只能 Q，給錯組合 analysis-ts 會回 400，這裡原樣轉發那個錯誤訊息。limit 預設 20、最大 40。total 是這個 symbol/metricCode/basis 組合總共有幾筆（不是這次回傳的筆數），hasMore 代表加大 limit 是否還能拿到更多。查無資料（代號沒 backfill 過，或代號不存在）回傳空陣列，不是 404——截至 2026-09-07 只有 2330 有資料，其餘代號都是空的。entries 由舊到新排序。",
  tags: ["Stock"],
  request: {
    params: symbolParam,
    query: metricHistoryQuerySchema.openapi("MetricHistoryQuery", { example: { metricCode: "peRatio", basis: "TTM", limit: 20 } }),
  },
  responses: {
    200: {
      description: "季度數列，查無資料時 entries 為空陣列。",
      content: { "application/json": { schema: metricHistorySchema } },
    },
    400: errorResponse("metricCode/basis 組合不合法、limit 超出 1-40 範圍，或缺少必填參數。"),
    502: unauthorized502,
  },
});

const metricsHistoryValueSchema = z.object({
  value: z.number().nullable(),
  nullReason: z.string().nullable(),
  knowledgeDate: z.string(),
  knowledgeDateIsFallback: z.boolean(),
});

const metricsHistoryEntrySchema = z.object({
  fiscalYear: z.number(),
  fiscalQuarter: z.number(),
  values: z.record(z.string(), metricsHistoryValueSchema),
});

const metricsHistorySchema = z
  .object({
    symbol: z.string(),
    metricCodes: z.array(z.string()),
    basis: z.string(),
    total: z.number(),
    hasMore: z.boolean(),
    entries: z.array(metricsHistoryEntrySchema),
  })
  .openapi("MetricsHistory", {
    example: {
      symbol: "2330",
      metricCodes: ["netIncomeGrowthRate", "epsGrowthRate", "shareCountChangeRate"],
      basis: "Q",
      total: 1,
      hasMore: false,
      entries: [
        {
          fiscalYear: 2026,
          fiscalQuarter: 2,
          values: {
            netIncomeGrowthRate: { value: 77.41, nullReason: null, knowledgeDate: "2026-08-11", knowledgeDateIsFallback: false },
            epsGrowthRate: { value: 77.41, nullReason: null, knowledgeDate: "2026-08-11", knowledgeDateIsFallback: false },
            shareCountChangeRate: { value: 0, nullReason: null, knowledgeDate: "2026-08-11", knowledgeDateIsFallback: false },
          },
        },
      ],
    },
  });

registry.registerPath({
  method: "get",
  path: "/stocks/{symbol}/metrics-history",
  summary: "一次查詢多個指標的季度歷史數列（成長分解卡片用，例如 EPS 成長分解、淨值成長分解）",
  description:
    "資料來自 oingg-analysis-ts 的 GET /companies/metrics-history——跟 metric-history 的差別是一次可以帶多個 metricCode（逗號分隔），一次拿到同一個 basis 底下每一期的所有指標值，不用每個指標各打一次。回應形狀也跟 metric-history 不同：entries 每一筆是 { fiscalYear, fiscalQuarter, values }，values 用 metricCode 當 key，不是單一 value 欄位。basis 不是固定列舉（不像 metric-history 的 metricCode 有寫死允許值）——不同 metricCode 組合允許的 basis 不一樣（實測：netIncomeGrowthRate/epsGrowthRate/shareCountChangeRate 系列的成長分解指標只允許 \"Q\"，不允許 \"TTM\"），實際允許值請查 GET /filters 各 metricCode 底下的 validTokens，這裡只驗證非空字串，實際合法性由 analysis-ts 驗證並回 400（原樣轉發那個錯誤訊息，例如帶了某個 metricCode 不支援的 basis）。EPS 成長分解卡片打法：metricCodes=netIncomeGrowthRate,epsGrowthRate,shareCountChangeRate&basis=Q；淨值成長分解卡片：metricCodes=equityGrowthRate,bvpsGrowthRate,shareCountChangeRate&basis=Q（兩張卡共用同一個 shareCountChangeRate，不用分別各打一次）。三者的近似恆等式：淨利/淨值成長率 ≈ EPS/BVPS成長率 + 股本變化率——shareCountChangeRate 為 0 代表股本沒變動；EPS/BVPS 成長率低於淨利/淨值成長率代表股本增加（現金增資/可轉債轉換，稀釋每股數字）；反之代表股本減少（減資/買回註銷，墊高每股數字）。limit 預設 20、最大 40，跟 metric-history 一致。查無資料回傳空陣列，不是 404——截至 2026-09-09 這批成長分解指標只有 2330 有資料（僅 1 期）。entries 由舊到新排序。",
  tags: ["Stock"],
  request: {
    params: symbolParam,
    query: metricsHistoryQuerySchema.openapi("MetricsHistoryQuery", {
      example: { metricCodes: "netIncomeGrowthRate,epsGrowthRate,shareCountChangeRate", basis: "Q", limit: 20 },
    }),
  },
  responses: {
    200: {
      description: "多指標季度數列，查無資料時 entries 為空陣列。",
      content: { "application/json": { schema: metricsHistorySchema } },
    },
    400: errorResponse("某個 metricCode 不支援指定的 basis、limit 超出 1-40 範圍，或缺少必填參數。"),
    502: unauthorized502,
  },
});

const roeHistorySchema = z
  .object({
    symbol: z.string(),
    basis: z.enum(["Q", "Q_ANN", "TTM"]),
    total: z.number(),
    hasMore: z.boolean(),
    entries: z.array(metricHistoryEntrySchema),
  })
  .openapi("RoeHistory", {
    example: {
      symbol: "2330",
      basis: "TTM",
      total: 20,
      hasMore: true,
      entries: [
        { fiscalYear: 2025, fiscalQuarter: 4, value: 31.7, nullReason: null, knowledgeDate: "2026-02-10", knowledgeDateIsFallback: false },
        { fiscalYear: 2026, fiscalQuarter: 1, value: 32.74, nullReason: null, knowledgeDate: "2026-05-12", knowledgeDateIsFallback: false },
      ],
    },
  });

registry.registerPath({
  method: "get",
  path: "/stocks/{symbol}/roe-history",
  summary: "查詢股東權益報酬率（ROE）的季度歷史數列",
  description:
    "資料來自 oingg-analysis-ts 的 GET /companies/roe-history。basis 允許 Q（單季）、Q_ANN（單季年化，即單季數字 ×4）、TTM（近四季）——跟 metric-history 不同，這支端點的三種 basis 都允許，不是每個 metricCode 各自限定一種。limit 預設 20、最大 40。total/hasMore 意義同 metric-history。查無資料回傳空陣列，不是 404。entries 由舊到新排序。",
  tags: ["Stock"],
  request: {
    params: symbolParam,
    query: roeRoaHistoryQuerySchema.openapi("RoeRoaHistoryQuery", { example: { basis: "TTM", limit: 20 } }),
  },
  responses: {
    200: {
      description: "季度數列，查無資料時 entries 為空陣列。",
      content: { "application/json": { schema: roeHistorySchema } },
    },
    400: errorResponse("basis 不合法、limit 超出 1-40 範圍，或缺少必填參數。"),
    502: unauthorized502,
  },
});

const roaHistorySchema = z
  .object({
    symbol: z.string(),
    basis: z.enum(["Q", "Q_ANN", "TTM"]),
    total: z.number(),
    hasMore: z.boolean(),
    entries: z.array(metricHistoryEntrySchema),
  })
  .openapi("RoaHistory", {
    example: {
      symbol: "2330",
      basis: "TTM",
      total: 20,
      hasMore: true,
      entries: [
        { fiscalYear: 2025, fiscalQuarter: 4, value: 21.65, nullReason: null, knowledgeDate: "2026-02-10", knowledgeDateIsFallback: false },
        { fiscalYear: 2026, fiscalQuarter: 1, value: 22.27, nullReason: null, knowledgeDate: "2026-05-12", knowledgeDateIsFallback: false },
      ],
    },
  });

registry.registerPath({
  method: "get",
  path: "/stocks/{symbol}/roa-history",
  summary: "查詢資產報酬率（ROA）的季度歷史數列",
  description: "資料來自 oingg-analysis-ts 的 GET /companies/roa-history。basis/limit/查無資料的行為跟 roe-history 完全一致，見該端點說明。",
  tags: ["Stock"],
  request: {
    params: symbolParam,
    query: roeRoaHistoryQuerySchema.openapi("RoaHistoryQuery", { example: { basis: "TTM", limit: 20 } }),
  },
  responses: {
    200: {
      description: "季度數列，查無資料時 entries 為空陣列。",
      content: { "application/json": { schema: roaHistorySchema } },
    },
    400: errorResponse("basis 不合法、limit 超出 1-40 範圍，或缺少必填參數。"),
    502: unauthorized502,
  },
});

const dupontHistoryEntrySchema = z.object({
  fiscalYear: z.number(),
  fiscalQuarter: z.number(),
  netProfitMarginPct: z.number().nullable(),
  assetTurnover: z.number().nullable(),
  equityMultiplier: z.number().nullable(),
  decomposedRoePct: z.number().nullable(),
  nullReason: z.string().nullable(),
  dupontTaxBurdenPct: z.number().nullable(),
  dupontInterestBurdenPct: z.number().nullable(),
  dupontEbitMarginPct: z.number().nullable(),
  dupontExtendedRoePct: z.number().nullable(),
  dupontExtendedRoeNullReason: z.string().nullable(),
  knowledgeDate: z.string(),
  knowledgeDateIsFallback: z.boolean(),
});

const dupontHistorySchema = z
  .object({
    symbol: z.string(),
    basis: z.enum(["Q", "TTM"]),
    total: z.number(),
    hasMore: z.boolean(),
    entries: z.array(dupontHistoryEntrySchema),
  })
  .openapi("DupontHistory", {
    example: {
      symbol: "2330",
      basis: "Q",
      total: 20,
      hasMore: true,
      entries: [
        {
          fiscalYear: 2026,
          fiscalQuarter: 1,
          netProfitMarginPct: 50.48,
          assetTurnover: 0.13,
          equityMultiplier: 1.47,
          decomposedRoePct: 9.65,
          nullReason: null,
          dupontTaxBurdenPct: 83.23,
          dupontInterestBurdenPct: 99.61,
          dupontEbitMarginPct: 60.89,
          dupontExtendedRoePct: 9.65,
          dupontExtendedRoeNullReason: null,
          knowledgeDate: "2026-05-12",
          knowledgeDateIsFallback: false,
        },
      ],
    },
  });

registry.registerPath({
  method: "get",
  path: "/stocks/{symbol}/dupont-history",
  summary: "查詢 ROE 杜邦分析（3 因子＋5 因子拆解）的季度歷史數列",
  description:
    "資料來自 oingg-analysis-ts 的 GET /companies/dupont-history。跟 metric-history/roe-history/roa-history 不同，這支端點每季回傳的是拆解後的多個數字，不是單一 value：3 因子（netProfitMarginPct×assetTurnover×equityMultiplier=decomposedRoePct）以及 5 因子擴展版（dupontTaxBurdenPct×dupontInterestBurdenPct×dupontEbitMarginPct×assetTurnover×equityMultiplier=dupontExtendedRoePct，2026-09-07 新增，同一個回應內，不需要額外參數）。5 因子有自己獨立的 dupontExtendedRoeNullReason，跟 3 因子的 nullReason 是分開的兩個欄位——5 因子的完整性檢查比 3 因子嚴格，可能 3 因子都有值但 5 因子還是 null。basis 只允許 Q、TTM，沒有 Q_ANN（跟 roe/roa-history 不同）。equityMultiplier 實測在 basis=TTM 時常是 null、basis=Q 時才有值，還沒跟 analysis-ts 正式確認原因，不要假設所有 TTM 資料都一定沒有這個欄位。limit 預設 20、最大 40。total/hasMore 意義同 metric-history。查無資料回傳空陣列，不是 404。entries 由舊到新排序。",
  tags: ["Stock"],
  request: {
    params: symbolParam,
    query: dupontHistoryQuerySchema.openapi("DupontHistoryQuery", { example: { basis: "Q", limit: 20 } }),
  },
  responses: {
    200: {
      description: "季度數列，查無資料時 entries 為空陣列。",
      content: { "application/json": { schema: dupontHistorySchema } },
    },
    400: errorResponse("basis 不合法、limit 超出 1-40 範圍，或缺少必填參數。"),
    502: unauthorized502,
  },
});

const monthlyRevenueHistoryEntrySchema = z.object({
  yearMonth: z.string(),
  reportDate: z.string(),
  industry: z.string(),
  currentMonthRevenue: z.string(),
  lastYearSameMonthRevenue: z.string(),
  yoyChangePercent: z.number().nullable(),
  momChangePercent: z.number().nullable(),
  cumulativeRevenue: z.string(),
  cumulativeLastYearRevenue: z.string(),
  cumulativeChangePercent: z.number().nullable(),
  note: z.string().nullable(),
});

const monthlyRevenueHistorySchema = z
  .object({
    symbol: z.string(),
    total: z.number(),
    hasMore: z.boolean(),
    entries: z.array(monthlyRevenueHistoryEntrySchema),
  })
  .openapi("MonthlyRevenueHistory", {
    example: {
      symbol: "2330",
      total: 60,
      hasMore: true,
      entries: [
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
    },
  });

registry.registerPath({
  method: "get",
  path: "/stocks/{symbol}/monthly-revenue-history",
  summary: "查詢月營收年增率/月增率歷史（月營收年增率圖表用）",
  description:
    "資料來自 oingg-analysis-ts 的 GET /companies/monthly-revenue-history——一次性 60 個月 backfill（截至 2026-09-07 僅 2330 有資料，其餘代號回傳空陣列，不是 404）。currentMonthRevenue/lastYearSameMonthRevenue/cumulativeRevenue/cumulativeLastYearRevenue 是新台幣千元金額，序列化成字串避免精度問題；yoyChangePercent/momChangePercent/cumulativeChangePercent 是數字，缺乏可比較基期時為 null（例如整個序列最早一個月沒有更早的月份可比，momChangePercent 會是 null，即使 yoyChangePercent 有值）。note 是公司自行揭露的說明文字，analysis-ts 會給字面上的「無」字串（不是 null）代表公司回報「沒有特別說明」，真正的 null 只有在完全沒有揭露欄位時才會出現。limit 是 1-120（跟其他歷史類端點的 1-40 不一樣，這支端點自己的上限比較大），不給 limit 預設回傳全部（不像 metric-history 系列預設只給 20 筆）。total/hasMore 意義同 metric-history。entries 由舊到新排序。",
  tags: ["Stock"],
  request: {
    params: symbolParam,
    query: monthlyRevenueHistoryQuerySchema.openapi("MonthlyRevenueHistoryQuery", { example: { limit: 12 } }),
  },
  responses: {
    200: {
      description: "月營收歷史，查無資料時 entries 為空陣列。",
      content: { "application/json": { schema: monthlyRevenueHistorySchema } },
    },
    400: errorResponse("limit 超出 1-120 範圍，或缺少必填參數。"),
    502: unauthorized502,
  },
});

const foreignShareholdingHistoryEntrySchema = z.object({
  tradeDate: z.string(),
  sharesHeldPercent: z.number(),
  foreignLimitPercent: z.number(),
  availableInvestPercent: z.number(),
});

const foreignShareholdingHistorySchema = z
  .object({
    symbol: z.string(),
    entries: z.array(foreignShareholdingHistoryEntrySchema),
  })
  .openapi("ForeignShareholdingHistory", {
    example: {
      symbol: "2330",
      entries: [
        { tradeDate: "2026-09-07", sharesHeldPercent: 69.27, foreignLimitPercent: 100, availableInvestPercent: 30.72 },
        { tradeDate: "2026-09-04", sharesHeldPercent: 69.21, foreignLimitPercent: 100, availableInvestPercent: 30.78 },
      ],
    },
  });

registry.registerPath({
  method: "get",
  path: "/stocks/{symbol}/foreign-shareholding-history",
  summary: "查詢外資持股比例每日歷史",
  description:
    "資料來自 oingg-analysis-ts 自己的 GET /stocks/:symbol/foreign-shareholding-history——跟這個網域其他歷史類端點不同，analysis-ts 這支本來就是 /stocks/:symbol/... 的路徑形狀（不是 /companies/xxx-history?symbol=），沒有 basis 參數。entries 是「新到舊」排序，跟 metric-history/roe-history/roa-history/dupont-history/monthly-revenue-history 的「舊到新」相反，請留意。limit 是 1-1500（確認過是即時資料，遠比其他季度/月度歷史端點的上限大），不給 limit 預設只回 250 筆，不是全部——實測 2330 給 limit=1500 拿到 1224 筆回溯到 2021 年，不給 limit 只有 250 筆回溯到 2025-08，兩者範圍不同，不要假設不給 limit 等於「查全部」。這支端點沒有 total/hasMore 欄位（跟其他 5 支歷史端點不同，已直接向 analysis-ts 確認過回應形狀，不是遺漏）。foreignLimitPercent 是該股票的外資持股上限（法規），100 代表無上限；availableInvestPercent = foreignLimitPercent - sharesHeldPercent，還有多少空間才會觸頂。查無資料（代號不存在）回傳空陣列，不是 404。",
  tags: ["Stock"],
  request: {
    params: symbolParam,
    query: foreignShareholdingHistoryQuerySchema.openapi("ForeignShareholdingHistoryQuery", { example: { limit: 90 } }),
  },
  responses: {
    200: {
      description: "每日外資持股比例歷史，查無資料時 entries 為空陣列。",
      content: { "application/json": { schema: foreignShareholdingHistorySchema } },
    },
    400: errorResponse("limit 超出 1-1500 範圍。"),
    502: unauthorized502,
  },
});
