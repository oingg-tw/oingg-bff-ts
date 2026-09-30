import { z } from "zod";
import { errorResponse, registry } from "@/http/swagger/registry.js";
import {
  companyListQuerySchema,
  dupontHistoryQuerySchema,
  exDividendCalendarQuerySchema,
  financialStatementQuerySchema,
  dailyPriceHistoryQuerySchema,
  foreignShareholdingHistoryQuerySchema,
  metricHistoryQuerySchema,
  metricProvenanceQuerySchema,
  metricsHistoryQuerySchema,
  monthlyRevenueHistoryQuerySchema,
  piotroskiBreakdownQuerySchema,
  preferredStocksQuerySchema,
  roeRoaHistoryQuerySchema,
} from "@/http/modules/stock/route.js";

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

const companyListSchema = z
  .object({
    count: z.number(),
    limit: z.number(),
    offset: z.number(),
    entries: z.array(
      z.object({
        symbol: z.string(),
        name: z.string(),
        market: z.string(),
        sectorCode: z.string().nullable(),
        sectorName: z.string().nullable(),
        isEmerging: z.boolean(),
      }),
    ),
  })
  .openapi("CompanyList");

registry.registerPath({
  method: "get",
  path: "/stocks",
  summary: "全市場上市／上櫃公司代號與名稱清單（全站搜尋股票用的資料來源）",
  description:
    "資料來自 oingg-analysis-ts 的 GET /companies，來源是 twse-ts/tpex-ts 各自的 company_profile 表（代號衝突時以上市優先去重）。目前約 2650 檔，需要分頁：limit 1-1000（預設 200），offset 預設 0，offset 超過 count 時回傳空的 entries 陣列（不是錯誤）。前端要拿到全市場清單需要自己依 count 迴圈呼叫多次，這支端點單純原樣轉發 analysis-ts 的分頁參數，不會在 bff-ts 這邊多次呼叫組成單一大回應。market 是 \"TWSE\"（上市）或 \"TPEx\"（上櫃），sectorCode/sectorName 是證交所類股代碼／名稱（見 GET /industries/securities-sectors），三者都是 2026-09-19 新增，analysis-ts 尚未分類的公司 sectorCode/sectorName 會是 null。isEmerging（2026-09-23 新增，恆有值不會是 null）標示是否為**興櫃**公司：這份目錄刻意包含興櫃，實測 2,349 家＝興櫃 363 ＋ 上市櫃 1,986，而生態系其他服務口中的「全市場」一律只指上市＋上櫃（mops-ts 是 1,985 家，差 1 家是去重邊界）。**拿這份目錄當覆蓋率分母前請先扣掉 isEmerging=true**——興櫃沒有月營收強制揭露，任何以月營收推導的指標對它們永遠是 null，不扣掉會讓分母多出 364 家永遠算不出來的公司。",
  tags: ["Stock"],
  request: { query: companyListQuerySchema.openapi("CompanyListQuery", { example: { limit: 200, offset: 0 } }) },
  responses: {
    200: {
      description: "公司清單，count 是全市場總數（不受這次 limit 影響），可用來判斷還要不要繼續分頁。",
      content: { "application/json": { schema: companyListSchema } },
    },
    400: errorResponse('limit 不是 1-1000 之間的整數，或 offset 不是非負整數。'),
    502: unauthorized502,
  },
});

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
    /** Exchange 編製財務報告類型 code — "1" = 合併, "2" = 個別. Opposite numbering from metricDataType. */
    financialReportType: z.string().nullable(),
    /** Label for financialReportType — mapping corrected 2026-09-22 (was backwards; 2330 is 合併財報). */
    financialReportTypeName: z.string().nullable(),
    /** Statement basis analysis-ts actually uses for this company's metrics, MOPS dataType numbering: "2" = 合併報表, "1" = 個體報表 (~249 individual-only filers). Added 2026-09-22. */
    metricDataType: z.enum(["1", "2"]),
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
      financialReportTypeName: "合併財報",
      metricDataType: "2",
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

const betaWindowSchema = z.object({
  timeframe: z.enum(["1Y_1D", "2Y_1W", "3Y_1W", "5Y_1M"]),
  value: z.number().nullable(),
  nullReason: z.string().nullable(),
  tradeDate: z.string().nullable(),
  knowledgeDate: z.string().nullable(),
  knowledgeDateIsFallback: z.boolean().nullable(),
});

const betaResultSchema = z
  .object({
    symbol: z.string(),
    windows: z.array(betaWindowSchema),
  })
  .openapi("BetaResult", {
    example: {
      symbol: "2330",
      windows: [
        { timeframe: "1Y_1D", value: 1.0839, nullReason: null, tradeDate: "2026-09-11", knowledgeDate: "2026-09-11", knowledgeDateIsFallback: false },
        { timeframe: "2Y_1W", value: 1.0953, nullReason: null, tradeDate: "2026-09-11", knowledgeDate: "2026-09-11", knowledgeDateIsFallback: false },
        { timeframe: "3Y_1W", value: 1.2036, nullReason: null, tradeDate: "2026-09-11", knowledgeDate: "2026-09-11", knowledgeDateIsFallback: false },
        { timeframe: "5Y_1M", value: 1.2215, nullReason: null, tradeDate: "2026-09-11", knowledgeDate: "2026-09-11", knowledgeDateIsFallback: false },
      ],
    },
  });

registry.registerPath({
  method: "get",
  path: "/stocks/{symbol}/beta",
  summary: "查詢個股 Beta 係數（四個固定期間窗口）",
  description:
    "資料來自 oingg-analysis-ts 的 GET /companies/beta。windows 固定是 1Y_1D／2Y_1W／3Y_1W／5Y_1M 四個窗口、固定這個順序（不是分頁的時間序列；3Y_1W 為 2026-09-16 新增）。查無資料或代號不存在時仍回 200，四個窗口的 value/nullReason/tradeDate/knowledgeDate/knowledgeDateIsFallback 全部是 null，不會是 404。",
  tags: ["Stock"],
  request: { params: symbolParam },
  responses: {
    200: { description: "三個窗口的 Beta 係數。", content: { "application/json": { schema: betaResultSchema } } },
    502: unauthorized502,
  },
});

const companyBadgeEntrySchema = z.object({
  metricCode: z.string(),
  name: z.string(),
  nameEn: z.string(),
  timeframe: z.string(),
  value: z.number().nullable(),
  nullReason: z.string().nullable(),
  knowledgeDate: z.string().nullable(),
  knowledgeDateIsFallback: z.boolean().nullable(),
  passed: z.boolean().nullable(),
  /** In the badge's stricter "danger zone" threshold — added 2026-09-20, so far only meaningful on piotroskiFScore. Null exactly when value is null; not the logical inverse of passed. */
  warning: z.boolean().nullable(),
  /** Percentile within the ranking population (0-100) — added 2026-09-21, always present but only non-null for badges whose threshold is a percentileRank (cross-sectional ranking) shape, e.g. novyMarxGpToAssets. */
  percentile: z.number().nullable(),
  /** Raw 1-based rank within the ranking population — null under the same condition as percentile. */
  rank: z.number().nullable(),
  /** Size of the ranking population — null under the same condition as percentile. */
  totalCount: z.number().nullable(),
  /** The metric value at the percentileRank cutoff, same unit as value — added 2026-09-22; null under the same condition as percentile. Can be a real 0. */
  thresholdValue: z.number().nullable(),
});

const companyBadgeCategorySchema = z.object({
  categoryKey: z.string(),
  categoryDisplayName: z.string(),
  badges: z.array(companyBadgeEntrySchema),
});

const companyBadgesResultSchema = z
  .object({
    symbol: z.string(),
    categories: z.array(companyBadgeCategorySchema),
  })
  .openapi("CompanyBadgesResult", {
    example: {
      symbol: "2330",
      categories: [
        {
          categoryKey: "resilience",
          categoryDisplayName: "財務韌性",
          badges: [
            {
              metricCode: "altmanZScore",
              name: "Altman Z-Score",
              nameEn: "Altman Z-Score",
              timeframe: "TTM",
              value: 15.51,
              nullReason: null,
              knowledgeDate: "2026-09-11",
              knowledgeDateIsFallback: false,
              passed: true,
              warning: null,
              percentile: null,
              rank: null,
              totalCount: null,
              thresholdValue: null,
            },
          ],
        },
      ],
    },
  });

registry.registerPath({
  method: "get",
  path: "/stocks/{symbol}/badges",
  summary: "查詢個股在各項「達人門檻」徽章上的實際數值與是否達成",
  description:
    "資料來自 oingg-analysis-ts 的 GET /companies/badges——跟 GET /metrics 每個指標底下的 badge 欄位是兩回事：那邊是徽章本身的定義（名稱/門檻/方法論，全市場通用不分公司），這支才是「這家公司」在這個徽章上算出來的實際數值跟是否達成（passed）。passed 是唯一真相來源，前端／bff-ts 都不應該自己拿 value 去跟 GET /metrics 的 badge.threshold 比較重新算一次——不同徽章的門檻比較邏輯不一致，也沒處理產業排除等 null 情境，analysis-ts 就是為了避免這個問題才做這支端點。查無資料或代號不存在時仍回 200，每個徽章的 value/nullReason/knowledgeDate/knowledgeDateIsFallback/passed/warning/percentile/rank/totalCount/thresholdValue 全部是 null，不會是 404。knowledgeDate/knowledgeDateIsFallback（2026-09-14 新增）跟 metrics-history/piotroski-breakdown 既有語意一致，knowledgeDateIsFallback 為 true 代表用財報期末日頂替，不是真實公告日。warning（2026-09-20 新增）標示這家公司是否落在該徽章更嚴格的「危險區」門檻（見 GET /metrics 每個指標 badge.threshold.warning）——null 有兩種情況：value 本身是 null（沒東西可評估，跟 passed 同一個情境），或這個徽章根本沒有定義危險區門檻（目前只有 piotroskiFScore 有，其餘徽章實測皆為 warning:null，就算 passed 有真實值也一樣，不要把 null 當成 false）。也不是 passed 的邏輯反面——passed:false 不代表 warning 一定是 true（例如分數不上不下、既非高分也非低分的情況）。percentile/rank/totalCount（2026-09-21 新增）是這家公司在橫斷面排名裡的位置——每一筆徽章回應永遠都有這 3 個欄位（不是選填），但只有門檻本身是「排名型」（GET /metrics 的 badge.threshold.percentileRank，例如 novyMarxGpToAssets 的「全市場前 20%」）才會有實際數值，其餘固定值型門檻的徽章這 3 個欄位一律是 null，不是缺資料。percentile 是 0-100 的百分位，rank 是 1-based 原始名次，totalCount 是排名母體總數。thresholdValue（2026-09-22 新增）是排名分界線對應的指標值——也就是 value 要達到多少才剛好站在「前 N%」的邊界上，單位跟 value 相同，讓前端能顯示「你的值是 42.61，門檻是 17.73」；null 的條件跟 percentile 完全一樣（非排名型徽章一律 null）。注意它可以是真實的 0（例如 2330 的 shareholderYield：thresholdValue 0、percentile 88.6），不要把 0 當成缺資料。",
  tags: ["Stock"],
  request: { params: symbolParam },
  responses: {
    200: { description: "依分類分組的徽章清單。", content: { "application/json": { schema: companyBadgesResultSchema } } },
    502: unauthorized502,
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

const dividendEventSchema = z.object({
  fiscalQuarter: z.number().nullable(),
  cashDividend: z.number(),
  cashDividendFromEarnings: z.number(),
  cashDividendFromLegalReserveAndCapitalSurplus: z.number(),
  stockDividend: z.number(),
  exDividendDate: z.string().nullable(),
  exRightsDate: z.string().nullable(),
  paymentDate: z.string().nullable(),
  announcementDate: z.string(),
  closeAtExDate: z.number().nullable(),
  yieldAtExDate: z.number().nullable(),
});

const dividendHistorySchema = z
  .object({
    symbol: z.string(),
    entries: z.array(
      z.object({
        fiscalYear: z.number(),
        rocFiscalYear: z.number(),
        cashDividend: z.number(),
        cashDividendFromEarnings: z.number(),
        cashDividendFromLegalReserveAndCapitalSurplus: z.number(),
        stockDividend: z.number(),
        totalDividend: z.number(),
        distributionCount: z.number(),
        exDividendDate: z.string().nullable(),
        exRightsDate: z.string().nullable(),
        paymentDate: z.string().nullable(),
        eps: z.number().nullable(),
        payoutRatio: z.number().nullable(),
        yieldAtExDate: z.number().nullable(),
        knowledgeDate: z.string(),
        events: z.array(dividendEventSchema),
      }),
    ),
  })
  .openapi("DividendHistory");

registry.registerPath({
  method: "get",
  path: "/stocks/{symbol}/dividend-history",
  summary: "查詢歷年股利發放紀錄（含現金股利、股票股利，一個年度可能分多次發放）",
  description:
    "資料來自 oingg-analysis-ts 的 GET /companies/dividend-history，2026-09-19 新增。entries 由舊到新排序（跟 capital-stock-history 的新到舊相反）。每個 entries[] 是一個「所屬年度」的彙總（cashDividend/stockDividend/totalDividend/exDividendDate/exRightsDate/paymentDate 是該年度的總計或最後一次發放的日期），events[] 再把同一年度拆成個別發放次數（distributionCount 決定 events 長度；只發放一次時 fiscalQuarter 為 null）。**eps 是年報公告的基本每股盈餘（等同 metrics-history 的 eps.FY），不是四個單季 EPS 相加**（上游 2026-09-25 改的），payoutRatio 跟著它算。兩者差在分母：年報用全年加權平均股數、單季序列用期末股本，全市場只有約 65% 的公司在 0.01 元內一致。沒有年報的年度兩者都是 null（一般公司的 2026 年度），上游 114 年年報缺 EPS 科目的 757 家也是 null。**這裡的 payoutRatio 對應 GET /metrics 的 dividendPayoutRatio.FY，不對應 .TTM**（上游 2026-09-28 新增 FY 口徑）：FY 用的是**同一個抽出來的共用函式**，所以兩處逐年一致、不會漂（實測 2330 FY 2023/2024/2025 = 40.2／37.57／33.2）。而 .TTM 是另一個量——「近四季實際發放的股利 ÷ 近四季淨利」，兩個窗口不同，所以獲利變動時比率會跟著動、即使配息政策沒變；它的分子取自現金流量表、含法定盈餘公積與資本公積發放且無法拆開，所以有公積發放的公司 .TTM 會高於 .FY。**兩個 timeframe 的分子語意不同（FY 是宣告、TTM 是實際付出），不要並排當同一個量比較**；要看配息政策有沒有改變請用 FY。**而且 .TTM 落在哪一季無法從任何日期推算**：2026-09-28 對 4994 逐年實測六年（上游 mops 逐格核對原始文件），現金流量表把股利記在「除息日那一季」符合 6 年中的 5 年、記在「付款日那一季」只符合 2 年，民國 115 年兩種都不符（除息日在 115Q2 卻是 0，已認列但現金未付，預期落在 115Q3）。所以**申報的現金流量表是唯一權威**，這支端點的 paymentDate 不能用來推論該筆現金會出現在哪一季——會出現「公告寫七月發了股利，但那一季的 .TTM 是 0」這種看起來矛盾、實際兩邊都對的情形。真的需要一個「預期位置」做交叉檢查時，請容許**相鄰兩季**（除息日那一季或下一季），不要釘死一季。2026-09-25 新增 cashDividendFromEarnings / cashDividendFromLegalReserveAndCapitalSurplus（年度列與 events[] 都有，**一定是數字、不會是 null**：公告上那一格空白時上游併成 0，所以 0 的意思是「公告沒有這筆金額」而不是「不知道」。若這兩個欄位真的缺席，bff-ts 會回 502 而不是靜默給 null——那只可能是兩個服務版本錯開），說明現金股利的來源；cashDividend 仍是兩者合計，但 **payoutRatio 的分子在 2026-09-25 改成只算 cashDividendFromEarnings**（同名、數值會變）：2882 國泰金 111 年度從 34.88 變成 0，因為那 0.9 元全部來自公積。需要「合計 ÷ EPS」的請自行計算。全部來自公積時 payoutRatio 是 **0 不是 null**；eps ≤ 0 或為 null 時才是 null。第二個欄位原名 cashDividendFromCapitalReserve，同日改為 cashDividendFromLegalReserveAndCapitalSurplus——MOPS 的原始欄位是「法定盈餘公積、資本公積發放之現金」，兩者在來源就合在一欄拆不開，而**法定盈餘公積是以前年度盈餘提存的、不是退還股本**，所以不要把這一欄整體描述成退還資本。**兩個來源各自四捨五入，相加可能跟 cashDividend 差 0.01，所以不要拿相加去驗證合計。** 公告只分「盈餘」與「法定盈餘公積＋資本公積」兩類，不區分當年或以前年度的盈餘。`cashDividendFromEarnings` 高於該年度 `eps` 時，超出的部分必定來自以前年度累積盈餘——**但反向不成立**：不高於 eps 什麼都證明不了（3045 台灣大 112 年度盈餘分配 3.63 < EPS 4.33，那 3.63 裡面仍可能混有以前年度）。實測約只有一成的公司年度推得出來，所以不要把這個拆分當成普遍可見。上游實測民國 110~113 有 498 個公司年度的盈餘分配超過當年 EPS，另有 164 個虧損卻發股利、其中 80 個含公積發放。想要真正的年度歸屬要另接 XBRL 權益變動表（mops-ts 已收、analysis-ts 尚未接）或 MOPS t05st09 決議口徑（無人抓過）。yieldAtExDate/closeAtExDate 要等除息日當天收盤價確定才會有值，未來或剛公告的除息日會是 null。查無資料回傳空陣列，不是 404。**不要拿這支端點去驗證 GET /metrics 的 consecutiveDividendYears，兩者資料源不同、深度也不同**（同 exchangePeRatio vs peRatio 的關係）：這支來自 mops 的股利分派公告（export.dividend_distribution），連續配息年數則來自現金流量表的「發放股利」（XBRL dividends_paid_financing）。2026-09-22 實測：股利公告表 2025 年度有 1,469 家，更早的年度全市場只有 30~47 家，所以多數公司目前只查得到 1 個年度；反過來 consecutiveDividendYears 因為 XBRL 從民國 110 年才全面鋪開而普遍是 5（889 家並列，數字等於上限時語意是「至少 N 年」）。兩邊對同一家公司給出不同年數是正常的，不是任一邊算錯。mops-ts 已排定股利分派 10 年全市場回補（1,985 家、民國 106~115），跑完這支會變深，但 consecutiveDividendYears 不會跟著變。",
  tags: ["Stock"],
  request: { params: symbolParam },
  responses: {
    200: {
      description: "歷年股利發放紀錄，查無資料時 entries 為空陣列。",
      content: { "application/json": { schema: dividendHistorySchema } },
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
    "**這支是申報原值，不做任何股數換算**（2026-09-30 補充）：其中 `basic_earnings_loss_per_share` 是公司用**期間加權平均股數**算的，而 `GET /stocks/{symbol}/metrics-history` 的 `eps` 是上游用**季末流通股數**算的，且已把分割、配股、股數合併式減資換算到今天的基準。季中有股數變動、或歷史上有過分割類事件的公司，兩支端點的每股數字**必然不同而且都對**。要對帳請固定用同一種來源，不要混用。" +
    "資料來自 oingg-analysis-ts 的 GET /companies/financial-statement。三種 statementType 各自的科目欄位不同（balanceSheet/incomeStatement/cashFlowStatement），欄位為 camelCase，金額一律序列化成字串（bigint 避免精度問題），incomeStatement 的 eps/epsDiluted 原始資料就是字串（非序列化所致）。金額欄位（eps/epsDiluted 除外）單位是新台幣千元——這點 analysis-ts 沒有在回應裡明講，2026-09-19 用 2330 實際數字反推確認（例如單季 revenue 約 1.27 兆元對應原始數字 1,270,380,250，assets 約 9.4 兆元對應 9,375,654,727，量級都對得上），跟 monthly-revenue-history 端點的新台幣千元慣例一致；eps/epsDiluted 本身就是每股金額（元），不是千元。欄位值為 null 代表財報本來就沒揭露該科目或為零，不代表查詢失敗。**year 是民國年、回應的 fiscalYear 卻是西元年**（送 `year=114` 拿回 `fiscalYear: 2025`），season 是 \"1\"~\"4\"。送四位數的西元年會被 bff-ts 以 400 擋下並說明原因（2026-09-30 加的：在那之前是上游回 400、這一層轉成一句沒有資訊的 502，而 502 在前端的 fallback 會顯示成「資料不足」，讓一個參數錯誤看起來像資料覆蓋率問題）。不給 year/season 會查最新一季；查無資料（代號不存在，或指定的 year/season 沒有申報資料）回應 found:false、statement:null，仍是 200，不是 404。dataType/subsidiaryCompanyId 是 analysis-ts 內部欄位原樣轉發，語意未正式核對過。",
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

const piotroskiBreakdownGroupsSchema = z
  .object({
    profitability: z.object({
      positiveRoa: z.boolean().nullable(),
      positiveCfo: z.boolean().nullable(),
      roaImproved: z.boolean().nullable(),
      accrualQuality: z.boolean().nullable(),
    }),
    leverageLiquidity: z.object({
      leverageDecreased: z.boolean().nullable(),
      liquidityImproved: z.boolean().nullable(),
      noDilution: z.boolean().nullable(),
    }),
    operatingEfficiency: z.object({
      grossMarginImproved: z.boolean().nullable(),
      assetTurnoverImproved: z.boolean().nullable(),
    }),
  })
  .nullable();

const piotroskiGroupMetadataSchema = z.object({
  key: z.enum(["profitability", "leverageLiquidity", "operatingEfficiency"]),
  name: z.string(),
  nameEn: z.string(),
  summary: z.string(),
  detail: z.string(),
  denominator: z.number(),
});

const piotroskiBreakdownSchema = z
  .object({
    symbol: z.string(),
    found: z.boolean(),
    fiscalYear: z.number().nullable(),
    fiscalQuarter: z.number().nullable(),
    knowledgeDate: z.string().nullable(),
    knowledgeDateIsFallback: z.boolean().nullable(),
    totalScore: z.number().nullable(),
    groups: piotroskiBreakdownGroupsSchema,
    groupMetadata: z.array(piotroskiGroupMetadataSchema),
    signalLabels: z.record(z.string(), z.string()),
  })
  .openapi("PiotroskiBreakdown", {
    example: {
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
      groupMetadata: [
        {
          key: "profitability",
          name: "獲利能力",
          nameEn: "Profitability",
          summary: "公司本業有沒有在賺錢、賺得比去年好。",
          detail: "對應 Piotroski (2000) 原始論文的 4 個獲利能力訊號。",
          denominator: 4,
        },
      ],
      signalLabels: { positiveRoa: "資產報酬率（ROA）為正" },
    },
  });

registry.registerPath({
  method: "get",
  path: "/stocks/{symbol}/piotroski-breakdown",
  summary: "查詢 Piotroski F-Score 底下 9 個布林訊號的分類拆解（獲利能力/財務韌性/營運周轉）",
  description:
    "資料來自 oingg-analysis-ts 的 GET /companies/piotroski-breakdown。原本既有的 piotroskiFScore.Q 是單一 9 分的總分，這支端點回傳算出這 9 分底下的個別布林訊號，依 3 個分類分組（profitability 4 項、leverageLiquidity 3 項、operatingEfficiency 2 項），用途是把原本一顆 9 分的 Piotroski 徽章拆成 3 顆分別掛在對應分類（獲利能力/財務韌性/營運周轉）底下的子徽章。單純原樣轉發，bff-ts 不做任何計算——`totalScore` 沿用跟已持久化的 piotroskiFScore.Q 一樣的「一項訊號缺值，整個總分就是 null」規則，不是這支端點自己算的；每個分類底下要不要算出一個 4/3/2 分母的子分數、以及同樣的 null 傳播規則怎麼套用到子分數，由呼叫端（web-nuxt）自己決定，不在這支端點的職責內。**year 是民國年、回應的 fiscalYear 卻是西元年**（送 `year=114` 拿回 `fiscalYear: 2025`），season 是 \"1\"~\"4\"。送四位數的西元年會被 bff-ts 以 400 擋下並說明原因（2026-09-30 加的：在那之前是上游回 400、這一層轉成一句沒有資訊的 502，而 502 在前端的 fallback 會顯示成「資料不足」，讓一個參數錯誤看起來像資料覆蓋率問題）。不給 year/season 會查最新一季，跟 financial-statement 相同慣例；查無資料（代號不存在，或指定的 year/season 沒有申報資料）回應 found:false，其餘欄位（包含 groups）一律是 null，仍是 200，不是 404。`groupMetadata`（3 個分類各自的顯示名稱/summary/detail/denominator）跟 `signalLabels`（9 個布林訊號各自的中文標籤，例如 positiveRoa -> 「資產報酬率（ROA）為正」）是 2026-09-11 新增的靜態說明資料——描述的是方法論本身，不是這個股票代號的實際數據，所以就算 found 是 false（代號不存在）這兩個欄位一樣會有值，不會是空陣列/空物件。",
  tags: ["Stock"],
  request: {
    params: symbolParam,
    query: piotroskiBreakdownQuerySchema.openapi("PiotroskiBreakdownQuery", {
      example: { year: "115", season: "2" },
    }),
  },
  responses: {
    200: {
      description: "Piotroski F-Score 的分類拆解，查無資料時 found 為 false、其餘欄位（含 groups）皆為 null。",
      content: { "application/json": { schema: piotroskiBreakdownSchema } },
    },
    400: errorResponse('year/season 只給了其中一個。'),
    502: unauthorized502,
  },
});

const metricProvenanceEntrySchema = z.object({
  role: z.string(),
  fiscalYear: z.number().nullable(),
  fiscalQuarter: z.number().nullable(),
  type: z.enum(["statementField", "other"]),
  statementType: z.enum(["balanceSheet", "incomeStatement", "cashFlowStatement"]).nullable(),
  fieldKey: z.string().nullable(),
  sourceDescription: z.string().nullable(),
  value: z.union([z.string(), z.number()]).nullable(),
});

const metricProvenanceSchema = z
  .object({
    symbol: z.string(),
    metricCode: z.enum(["sue", "chowderNumber", "roe", "accrualsRatio", "dividendPayoutRatio", "altmanZScore"]),
    found: z.boolean(),
    fiscalYear: z.number().nullable(),
    fiscalQuarter: z.number().nullable(),
    value: z.number().nullable(),
    entries: z.array(metricProvenanceEntrySchema),
    methodologyNote: z.string().nullable(),
  })
  .openapi("MetricProvenance", {
    example: {
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
    },
  });

registry.registerPath({
  method: "get",
  path: "/stocks/{symbol}/metric-provenance",
  summary: "追溯某個指標算出來的數值，是從哪幾筆原始財報/申報資料算出來的",
  description:
    "資料來自 oingg-analysis-ts 的 GET /companies/{symbol}/metric-provenance，用途是「這個徽章/數字是怎麼算出來的」溯源功能。試點階段原本只支援 3 個 metricCode（sue、chowderNumber、roe），之後持續擴大中（已超過 100 個，實際支援清單請看 GET /metrics 每個指標的 hasProvenance 欄位——bff-ts 這邊不再寫死允許清單，2026-09-15 起改成完全由 analysis-ts 自己驗證，給不支援的 metricCode 會轉發 analysis-ts 自己的 400 訊息，裡面會列出當下實際支援的完整清單）。單純原樣轉發，不做任何計算。`entries` 是這個指標這一期算出來所依賴的每一筆原始資料，`type` 為 \"statementField\" 時代表來自財報科目（`statementType`/`fieldKey` 會有值），為 \"other\" 時代表來自財報以外的資料源（`sourceDescription` 是文字說明，例如「證交所／櫃買中心每日評價指標」或「公開發行公司股本變動申報」），兩者互斥。**`entries[].value` 沒有做任何型別正規化**——大多數是財報金額，序列化成字串避免 bigint 精度問題（例如 \"706561938\"），但至少有一種已在正式環境確認過的情況（chowderNumber 的現金殖利率「市場快照」那筆）是原生浮點數（例如 0.92），不是字串，前端不能假設固定是某一種型別。頂層的 `value`（這個指標本身這一期算出來的數值，例如 roe 的 34.78）則一律是數字。**year 是民國年、回應的 fiscalYear 卻是西元年**（送 `year=114` 拿回 `fiscalYear: 2025`），season 是 \"1\"~\"4\"。送四位數的西元年會被 bff-ts 以 400 擋下並說明原因（2026-09-30 加的：在那之前是上游回 400、這一層轉成一句沒有資訊的 502，而 502 在前端的 fallback 會顯示成「資料不足」，讓一個參數錯誤看起來像資料覆蓋率問題）。不給 year/season 會查最新一季，跟 financial-statement/piotroski-breakdown 相同慣例；查無資料（代號不存在，或指定的 year/season 沒有資料）回應 found:false，`entries` 為空陣列，其餘欄位皆為 null，仍是 200，不是 404。`methodologyNote`（例如 sue 的樣本標準差說明）通常是 null，只有需要額外文字說明計算方法時才會有值。",
  tags: ["Stock"],
  request: {
    params: symbolParam,
    query: metricProvenanceQuerySchema.openapi("MetricProvenanceQuery", {
      example: { metricCode: "roe" },
    }),
  },
  responses: {
    200: {
      description: "指標溯源資料，查無資料時 found 為 false、entries 為空陣列、其餘欄位皆為 null。",
      content: { "application/json": { schema: metricProvenanceSchema } },
    },
    400: errorResponse('"metricCode" 缺少或不是目前支援的指標（analysis-ts 的錯誤訊息會列出完整清單），或 year/season 只給了其中一個。'),
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

const exDividendCompositionSchema = z
  .object({
    dividendIncomePct: z.number().nullable(),
    interestIncomePct: z.number().nullable(),
    incomeEqualizationPct: z.number().nullable(),
    realizedCapitalGainPct: z.number().nullable(),
    otherIncomePct: z.number().nullable(),
  })
  .openapi("ExDividendComposition", {
    description:
      "ETF 配息組成（百分比）。**null 是「未揭露」、0 是「揭露了而且是零」，兩者意思不同**，而 0 在這裡很常見不是例外（2026-09 的 96 筆 ETF 有 90 筆的 incomeEqualizationPct 是 0），所以不要用 falsy 判斷——那會把「這次配息沒有動用收益平準金」講成「不知道」。" +
      "**五項加起來不一定是 100，而且加不滿的是哪些列不是隨機的**：2026-06~09 共 396 筆 ETF 實測，被動型 347 筆全部加總 100，主動型 49 筆有 8 筆不是（6 筆加不滿，例如 99.2、72.13、31.67，另 2 筆五項全 null）。所以要把它畫成完整的圓餅圖之前必須先檢查加總，剩下的部分**不能假設是零**——00404A 主動聯博動能50 只揭露 31.67%，其餘 68% 沒有歸屬。" +
      "**announced（未來）列上的這個物件是「上一次配息」的組成，不是預測。** 00939 的組成每一次都不同（100/0 → 35.87/64.13 → 41.06/58.94 → 42.4/57.6），而它 2026-10-05 的 announced 列帶的是 2026-09-01 的 42.4/57.6 逐字照抄。**這種列從 payload 本身看不出問題**（五項剛好加起來 100），所以請搭配 status 判斷：只在 realized 列把這個組成當作有意義的數字。bff-ts 依「代理端點零轉換」原樣轉發、不把它清成 null；已向 analysis-ts 確認這是否為刻意行為。",
  });

const exDividendCalendarEntrySchema = exDividendNoticeEntrySchema.extend({
  symbol: z.string(),
  companyName: z.string().nullable(),
  /** announced = TWSE/TPEx advance notice (ex-date >= today); realized = MOPS distribution record (ex-date < today). Added 2026-09-22. */
  status: z.enum(["announced", "realized"]),
  /** "YYYY-MM-DD" — realized rows only, null on announced. */
  paymentDate: z.string().nullable(),
  /** Dividend fiscal year (西元) — realized rows only, null on announced. */
  fiscalYear: z.number().int().nullable(),
  /** "ETF" or "COMMON". The three fields below are ETF-only (null on every COMMON row). */
  securityType: z.enum(["ETF", "COMMON"]).nullable(),
  /** "YYYY-MM-DD" 基準日 — ETF rows only. */
  recordDate: z.string().nullable(),
  /** 每單位分配金額 — an ETF row's only amount; its cashDividend is always null. */
  distributionPerUnit: z.number().nullable(),
  composition: exDividendCompositionSchema.nullable(),
});

registry.registerPath({
  method: "get",
  path: "/stocks/ex-dividend-calendar",
  summary: "查詢整月全市場的除息/除權事件（股利行事曆用，不限單一代號）",
  description:
    "資料來自 oingg-analysis-ts 的 GET /stocks/ex-dividend-calendar（2026-09-10 新增）。跟 ex-dividend-notices 的差別：這支是攤平的全市場清單（一次回傳整個月所有代號的事件，不用先知道代號），不是照代號分組，也沒有「只顯示未來事件」的過濾——查歷史月份或未來月份都會照實回傳當月真實發生（或已排定）的事件。month 格式必須是 \"YYYY-MM\"（例如 \"2026-09\"），格式錯誤或缺少會 400。每筆 entry 除了跟 ex-dividend-notices 一樣的欄位（exDate/exType/stockDividendRatio 等）外，多了 symbol 跟 companyName。companyName 型別上仍可為 null，但**上游現在連 ETF 都有名字**（2026-09-30 重測 2026-06~09 的 396 筆 ETF 全部有值）——這裡原本寫「ETF 不在公司名稱對照表裡」，那句 2026-09-10 是對的、之後就不是了，留著只會讓人以為可以靠它判斷是不是 ETF。要判斷請用 securityType。**securityType／recordDate／distributionPerUnit／composition（上游 2026-09-23 新增，bff-ts 2026-09-30 才接上）**：securityType 是 \"ETF\" 或 \"COMMON\"，後三個欄位只有 ETF 列有值（2026-09 實測 110 筆 COMMON 全 null、96 筆 ETF 全有值）。**distributionPerUnit 是 ETF 列唯一的金額**——ETF 的 cashDividend 一律是 null（96/96），所以只讀 cashDividend 的行事曆會讓當月將近一半的列沒有金額（2026-09 是 96/206）。announced 列的 distributionPerUnit 是 null，那是「金額真的還沒公布」（2026-10 的 14 筆 announced ETF 全部 null），跟「被我們漏掉」不同。composition 的 null/0 差異與「加總不一定是 100」「announced 列帶的是上一次的組成」請看 ExDividendComposition 的說明，那幾件事從 payload 本身看不出來。**status／paymentDate／fiscalYear（2026-09-22 新增，三個都必填）**：status 是 announced（除息日 >= 今天的證交所／櫃買中心預告）或 realized（除息日 < 今天的公開資訊觀測站股利分派公告），兩種來源不同、欄位也不同——paymentDate（\"YYYY-MM-DD\" 發放日）跟 fiscalYear（股利所屬年度，西元）只有 realized 列有值，announced 一律 null；反過來 realized 列的認購／增資相關欄位（subscriptionRatio、subscriptionPricePerShare、sharesOffered、sharesEmpOwner、sharesholderOwner、stockHoldingRatio）一律 null，因為公告來源不帶這些。這次擴張同時讓過去月份開始有資料（例如 2026-08 回 268 筆、含上櫃），之前歷史月份會是空的。查無資料的月份（例如太久遠或太未來）回傳空陣列，不是錯誤。",
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

/**
 * formulaVersion 的說明在這個檔案裡有兩處要用（單數 metric-history 的扁平列、複數 metrics-history 的
 * values），抽成一個常數是為了不讓兩份文案各自漂移——這個欄位的重點是「什麼時候不該快取」，說法不一致
 * 會讓下游對著兩種講法猜。
 *
 * analysis-ts 的原話（2026-09-26，commit b6d07abe）：「兩者不一致，代表這個值以較舊的算法計算、還沒
 * 重算到。它仍是自洽的結果，可以正常顯示，但不應快取。」
 */
const VERSION_FIELD_DOC =
  "這個值是用第幾版公式算出來的（2026-09-26 新增）。**只有一個方向可以依賴**：跟 GET /metrics 同一個指標的" +
  "formulaVersion 比對，**這裡比較舊 → 一定要重抓**（算法改過而這一列還沒重算到；值本身仍自洽、可以正常顯示，但不應快取）。" +
  "**反過來不成立：版本號相同並不代表這個值是現行算法算出來的。** 2026-09-28 實測 2317 的 bvps 與 marketCap 有連續 17 季" +
  "（2020Q3~2024Q3）是 null 而版本號等於型錄現值、跟有值的那幾季一模一樣——那些列是在股本回填完成前算的，" +
  "之後跳版時對「未受影響的列」只用 SQL 改了版本號、沒有重算值，於是舊的 null 繼承了新版本號。全市場每支依賴股數或市值的" +
  "指標約有 1~3 萬筆這種列（marketCap 12,647、pbRatio 12,554、tobinsQ 12,642、eps 10,524、bvps 7,774）。" +
  "上游 2026-09-28 起改掉這個做法（使用者決定）：跳版時未受影響的列**保留舊版本號**，只有真的重算過的列才拿到新版本，" +
  "所以之後「版本不一致 → 重抓」會自然抓到過期列；但 09-28 之前已被 SQL 改過的列不回溯處理，而是靠一次針對 14,708 組" +
  "（公司, 季）的補算修掉其中仍是過期 null 的那些。另外這個欄位**只反映公式本身改版**，而「公式」比直覺的範圍窄：" +
  "**上游的資料修正、以及上游取數規則的修正（股數來源、口徑、日期對齊）都不會動版本號**，值會變、版本不變。" +
  "2026-09-30 的實例：上游把季末股數改成一律以資產負債表股本為準（原本只在差超過 20% 時才改用），647 家、8,553 組" +
  "（公司, 季）的每股數字重算，formulaVersion 全部沒變（例如 6115 的 eps 原本每季高估約 14%，修正後 115Q2 為 0.76、" +
  "版本仍是 2）。會動版本號的是分母或稅務處理這類真的換公式的改動（例如每股分母從期末改成期間平均）。" +
  "所以**拿 formulaVersion 當 cache key 會漏掉整整一類會改變數值的變更**，那一類只能靠上游主動發清快取通知。" +
  "bff-ts 這一層宣告為 nullable，雖然上游契約說必填：缺席只會讓下游少一個提示、不會讓使用者看到錯的數字，" +
  "不值得為此讓整支端點失敗；真的缺席時 bff-ts 會記一筆 warning。";

const metricHistoryEntrySchema = z.object({
  fiscalYear: z.number(),
  fiscalQuarter: z.number(),
  value: z.number().nullable(),
  nullReason: z.string().nullable(),
  knowledgeDate: z.string(),
  knowledgeDateIsFallback: z.boolean(),
  formulaVersion: z.number().nullable().openapi({ description: VERSION_FIELD_DOC }),
  dataType: z.enum(["1", "2"]).nullable().openapi({ description: "這一期用的財務報表類型：**\"2\" = 合併報表、\"1\" = 個體報表**（MOPS 的 dataType 編號，**跟 profile 的 financialReportType 方向相反**）。2026-09-27 新增。逐期而不是逐公司的理由：有 31 家公司賣掉或併掉子公司後只申報個別報表，analysis-ts 把兩段歷史接成一條線，所以同一條數列裡轉換點之前是 \"2\"、之後是 \"1\"（實測 2941：2022 年是 \"2\"、2023 年起是 \"1\"）。一般公司每期恆為 \"2\"、249 家個別申報者恆為 \"1\"、2330 對照組四支端點全是 \"2\"。" + "**null 的意思是「這個指標不適用報表類型」而不是「不知道」**：日頻指標（exchangePeRatio、live* 等）沒有報表類型的概念，上游不送這個欄位（實測 2330 的 exchangePeRatio.EOD 有 tradeDate、沒有 dataType）。季頻指標（Q／TTM／FY）缺這個欄位才代表版本錯開。" }),
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
        { fiscalYear: 2025, fiscalQuarter: 2, value: 13.55, nullReason: null, knowledgeDate: "2025-08-12", knowledgeDateIsFallback: false, formulaVersion: 3 },
        { fiscalYear: 2025, fiscalQuarter: 3, value: 15.93, nullReason: null, knowledgeDate: "2025-11-11", knowledgeDateIsFallback: false, formulaVersion: 3 },
      ],
    },
  });

registry.registerPath({
  method: "get",
  path: "/stocks/{symbol}/metric-history",
  summary: "查詢 EPS/本益比/本淨比的季度歷史數列（個股詳細頁圖表用）",
  description:
    "**每股數字的股數基準跟申報原值不同，兩者在股數有變動的公司身上本來就不相等**（2026-09-30 釐清）：這支端點的每股指標是上游用**季末流通股數**算的（取生效日在報告日之前的最新一筆股本），而 `GET /stocks/{symbol}/financial-statement` 的 `basic_earnings_loss_per_share` 是公司用**期間加權平均股數**申報的原值。季中發生股數變動時兩者必然有差——實測 3041 揚智 2025Q2（2025-05 增資）本端點 -0.67、申報 -0.70，差約 4.5%；同一家公司 2026Q2 股數沒變，兩者都是 -0.21。**兩個數字都對，只是分母不同。**另外這支端點還會把**分割、配股、股數合併式減資**（股數變了但公司價值沒變的事件）換算到今天的股數基準，讓跨越這類事件的每股走勢圖不會憑空跳一階；**現金增資與現金減資不換算**，因為那有真的錢進出。financial-statement 完全不換算。所以要做「成分加總等於母項」這類對帳，**母項與成分必須全部取自同一種來源**——全用每股指標，或全用申報原值，混用會在有股數變動的公司身上讓恆等式失效，而症狀看起來像資料不全。" +
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
  formulaVersion: z.number().nullable().openapi({
    description:
      VERSION_FIELD_DOC +
      "注意這一層有**兩種**「沒有版本號」，不要混在一起處理：values[metricCode] 整格是 null，代表那個" +
      "指標在這一期從來沒被回填過（連格子都不存在）；格子存在但 formulaVersion 是 null，才是上游這一次" +
      "沒送這個欄位。",
  }),
});

const metricsHistoryEntrySchema = z.object({
  fiscalYear: z.number(),
  fiscalQuarter: z.number(),
  /** 期層級而不是 values[metricCode] 裡面：報表類型是逐期決定的，同一期的每個指標都一樣。 */
  dataType: z.enum(["1", "2"]).nullable().openapi({ description: "這一期用的財務報表類型：**\"2\" = 合併報表、\"1\" = 個體報表**（MOPS 的 dataType 編號，**跟 profile 的 financialReportType 方向相反**）。2026-09-27 新增。逐期而不是逐公司的理由：有 31 家公司賣掉或併掉子公司後只申報個別報表，analysis-ts 把兩段歷史接成一條線，所以同一條數列裡轉換點之前是 \"2\"、之後是 \"1\"（實測 2941：2022 年是 \"2\"、2023 年起是 \"1\"）。一般公司每期恆為 \"2\"、249 家個別申報者恆為 \"1\"、2330 對照組四支端點全是 \"2\"。" + "**null 的意思是「這個指標不適用報表類型」而不是「不知道」**：日頻指標（exchangePeRatio、live* 等）沒有報表類型的概念，上游不送這個欄位（實測 2330 的 exchangePeRatio.EOD 有 tradeDate、沒有 dataType）。季頻指標（Q／TTM／FY）缺這個欄位才代表版本錯開。" }),
  values: z.record(z.string(), metricsHistoryValueSchema.nullable()),
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
    "**每股數字的股數基準跟申報原值不同，兩者在股數有變動的公司身上本來就不相等**（2026-09-30 釐清）：這支端點的每股指標是上游用**季末流通股數**算的（取生效日在報告日之前的最新一筆股本），而 `GET /stocks/{symbol}/financial-statement` 的 `basic_earnings_loss_per_share` 是公司用**期間加權平均股數**申報的原值。季中發生股數變動時兩者必然有差——實測 3041 揚智 2025Q2（2025-05 增資）本端點 -0.67、申報 -0.70，差約 4.5%；同一家公司 2026Q2 股數沒變，兩者都是 -0.21。**兩個數字都對，只是分母不同。**另外這支端點還會把**分割、配股、股數合併式減資**（股數變了但公司價值沒變的事件）換算到今天的股數基準，讓跨越這類事件的每股走勢圖不會憑空跳一階；**現金增資與現金減資不換算**，因為那有真的錢進出。financial-statement 完全不換算。所以要做「成分加總等於母項」這類對帳，**母項與成分必須全部取自同一種來源**——全用每股指標，或全用申報原值，混用會在有股數變動的公司身上讓恆等式失效，而症狀看起來像資料不全。" +
    "資料來自 oingg-analysis-ts 的 GET /companies/metrics-history——跟 metric-history 的差別是一次可以帶多個 metricCode（逗號分隔），一次拿到同一個 basis 底下每一期的所有指標值，不用每個指標各打一次。回應形狀也跟 metric-history 不同：entries 每一筆是 { fiscalYear, fiscalQuarter, values }，values 用 metricCode 當 key，不是單一 value 欄位。**⚠️ 不要拿 entries 的最後一筆當「最新一季」**：只要查詢裡包含 `dividendDistributionCount`，最後一期可能是一個**只有那一支指標有值、其他全 null 的殘缺期**——它以除息公告日所屬的季為座標（上游的設計，不是財報期），所以會領先財報期一整季。2026-09-28 抽 50 家實測：28 家（56%）的最後一期是 2026Q3 且只有配息次數有值，而真正最新的財報期是 2026Q2 並且有值（例如 2330 的 2026Q3 只有 dividendDistributionCount=4、eps 是 null）。要取最新一期請以**你關心的那支指標有值的最後一期**為準，或不要把 dividendDistributionCount 跟財報期指標混在同一次呼叫裡。basis 不是固定列舉（不像 metric-history 的 metricCode 有寫死允許值）——不同 metricCode 組合允許的 basis 不一樣（實測：netIncomeGrowthRate/epsGrowthRate/shareCountChangeRate 系列的成長分解指標只允許 \"Q\"，不允許 \"TTM\"），實際允許值請查 GET /metrics 各 metricCode 底下的 validTokens，這裡只驗證非空字串，實際合法性由 analysis-ts 驗證並回 400（原樣轉發那個錯誤訊息，例如帶了某個 metricCode 不支援的 basis）。EPS 成長分解卡片打法：metricCodes=netIncomeGrowthRate,epsGrowthRate,shareCountChangeRate&basis=Q；淨值成長分解卡片：metricCodes=equityGrowthRate,bvpsGrowthRate,shareCountChangeRate&basis=Q（兩張卡共用同一個 shareCountChangeRate，不用分別各打一次）。三者的近似恆等式：淨利/淨值成長率 ≈ EPS/BVPS成長率 + 股本變化率——shareCountChangeRate 為 0 代表股本沒變動；EPS/BVPS 成長率低於淨利/淨值成長率代表股本增加（現金增資/可轉債轉換，稀釋每股數字）；反之代表股本減少（減資/買回註銷，墊高每股數字）。limit 預設 20、最大 40，跟 metric-history 一致。查無資料回傳空陣列，不是 404。entries 由舊到新排序。**values 底下每個 metricCode 的值可能是純 null（不是物件）**——當這個 metricCode 在這一期完全沒有回填資料時（例如兩個 metricCode 回填起始的季度不同，較晚才有資料的那個在較早的期別就是 null），這跟「有算出來但數值是 null（物件形式，帶 nullReason/knowledgeDate）」是兩種不同狀態，不要混為一談；2026-09-10 之前這裡曾經對純 null 值直接呼叫物件屬性存取，在 limit 夠大、涵蓋到某 metricCode 尚未回填的期別時會導致 500，已修正為正確保留 null。",
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
  dataType: z.enum(["1", "2"]).nullable().openapi({ description: "這一期用的財務報表類型：**\"2\" = 合併報表、\"1\" = 個體報表**（MOPS 的 dataType 編號，**跟 profile 的 financialReportType 方向相反**）。2026-09-27 新增。逐期而不是逐公司的理由：有 31 家公司賣掉或併掉子公司後只申報個別報表，analysis-ts 把兩段歷史接成一條線，所以同一條數列裡轉換點之前是 \"2\"、之後是 \"1\"（實測 2941：2022 年是 \"2\"、2023 年起是 \"1\"）。一般公司每期恆為 \"2\"、249 家個別申報者恆為 \"1\"、2330 對照組四支端點全是 \"2\"。" + "**null 的意思是「這個指標不適用報表類型」而不是「不知道」**：日頻指標（exchangePeRatio、live* 等）沒有報表類型的概念，上游不送這個欄位（實測 2330 的 exchangePeRatio.EOD 有 tradeDate、沒有 dataType）。季頻指標（Q／TTM／FY）缺這個欄位才代表版本錯開。" }),
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
    "資料來自 oingg-analysis-ts 的 GET /companies/dupont-history。跟 metric-history/roe-history/roa-history 不同，這支端點每季回傳的是拆解後的多個數字，不是單一 value：3 因子（netProfitMarginPct×assetTurnover×equityMultiplier=decomposedRoePct）以及 5 因子擴展版（dupontTaxBurdenPct×dupontInterestBurdenPct×dupontEbitMarginPct×assetTurnover×equityMultiplier=dupontExtendedRoePct，2026-09-07 新增，同一個回應內，不需要額外參數）。5 因子有自己獨立的 dupontExtendedRoeNullReason，跟 3 因子的 nullReason 是分開的兩個欄位——5 因子的完整性檢查比 3 因子嚴格，可能 3 因子都有值但 5 因子還是 null。basis 只允許 Q、TTM，沒有 Q_ANN（跟 roe/roa-history 不同）。equityMultiplier 在 basis=TTM 時曾經一律是 null（2026-09-07 觀察）——原因是當時這支指標只有 Q 一種 timeframe。2026-09-22 analysis-ts 分兩步修正：7df73c14 補上 TTM timeframe 並把分母改為期間平均（formulaVersion 2）；接著 a83577db 修掉這支端點不論查 Q 或 TTM 都寫死 join equityMultiplier.Q 的問題，改成跟查詢的 basis 同口徑——所以在 a83577db 之前 TTM 回應裡看到的 equityMultiplier 其實是 Q 值。2026-09-22 analysis-ts 通知全市場十季重算的第一批（含 ROE 家族）已完成，經 bff-ts 實測 2330 的 Q 與 TTM equityMultiplier 已是兩個不同的數字，TTM 是真正的 TTM 口徑。2023Q4／2024Q1 之間一度有一道公式接縫（十季重算只回溯到 2024Q1），analysis-ts 的十四季全歷史回填已於 2026-09-23 完成，**接縫已消失**：實測 2330 在 basis=TTM 下 2020Q3~2026Q2 整段都有 equityMultiplier 且一律四位小數，接縫兩側的值也已改寫（2022Q4 的 decomposedRoePct 由 34.91 變 40.14、2023Q4 由 24.20 變 26.17），所以任何在 2026-09-23 之前抓下來快取的杜邦歷史都該作廢重抓——**特別注意 knowledgeDate 不會跟著改**（2330 2022Q4 的值今天被改寫，knowledgeDate 仍是 2023-02-14，實測），它代表「市場何時知道這份財報」而不是「這個數字何時被重算」，所以拿 knowledgeDate 當快取鍵的下游不會自動失效。**資料實際起點 TTM 跟 Q 不一樣，畫圖前請注意**（2026-09-23 實測 2317／1101／1216 三家一致）：entries 雖然從 2020Q3 開始，但 **2020Q4 那一列整個不存在**（109Q4 的 XBRL 損益表全市場只有約 51 家），連帶任何包含它的近四季窗口都不完整——所以 basis=TTM 第一筆有值的季別實際上是 **2021Q4**（2020Q3、2021Q1~Q3 都是 null，nullReason=insufficient_history），basis=Q 則可以早到 **2021Q1**（2020Q3 是 null，nullReason=missing_input）。同一季在兩種口徑下 nullReason 不同是**刻意設計、不是不一致**：組合指標（decomposedRoePct 是三因子相乘）只報告「有輸入缺了」＝missing_input，真正的原因在因子那幾列（此例是 assetTurnover.Q 自己的 insufficient_history——它的分母要本季＋上季期末平均，而 2020Q2 的資產負債表在 XBRL 只有 47 家）；TTM 則因為「四季齊不齊」的判斷發生在相乘之前，組合函式拿得到那個資訊，所以直接給 insufficient_history。前端若要對使用者解釋「為什麼沒有數字」，規則是：**組合指標拿到 missing_input 時，去查同期的因子指標取真正原因**，不要把兩者當同義詞。2330 是少數例外，兩種口徑都回得到 2020Q3。這些 null 是資料起點造成的，不是個股缺漏，前端不需要顯示成錯誤。limit 預設 20、最大 40。total/hasMore 意義同 metric-history。查無資料回傳空陣列，不是 404。entries 由舊到新排序。",
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

const NO_TRADE_DOC =
  "**是交易日但當天沒有成交時是 null**，而同一列的 volume 仍可能非 0（零股或盤後，analysis-ts 未查證）。" +
  "這支端點刻意保留這些交易日，因為前端需要分辨「那天有開盤但沒成交」與「那天不是交易日」。" +
  "**畫圖時請把 null 當成無資料跳過、不要連線，也不要當成 0** —— 2026-09-27 之前 bff-ts 錯把它正規化成 0，" +
  "那些日子在圖上是掉到零的斷崖（實測抽 51 檔有 4 檔中招，1538 連續四天）。";

const bookValueBreakdownEntrySchema = z.object({
  fiscalYear: z.number(),
  openingBvps: z.number(),
  netIncome: z.number(),
  otherComprehensiveIncome: z.number(),
  cashDividends: z.number(),
  capitalIssued: z.number(),
  shareCountEffect: z.number(),
  other: z.number(),
  /** 這支端點只有年度資料、沒有日頻指標，所以是必填；缺了 bff-ts 回 502，不預設成 "2"。 */
  dataType: z.enum(["1", "2"]).openapi({ description: "這一期用的財務報表類型：**\"2\" = 合併報表、\"1\" = 個體報表**（MOPS 的 dataType 編號，**跟 profile 的 financialReportType 方向相反**）。2026-09-27 新增。逐期而不是逐公司的理由：有 31 家公司賣掉或併掉子公司後只申報個別報表，analysis-ts 把兩段歷史接成一條線，所以同一條數列裡轉換點之前是 \"2\"、之後是 \"1\"（實測 2941：2022 年是 \"2\"、2023 年起是 \"1\"）。一般公司每期恆為 \"2\"、249 家個別申報者恆為 \"1\"、2330 對照組四支端點全是 \"2\"。" }),
  closingBvps: z.number(),
});

const bookValueBreakdownSchema = z
  .object({ symbol: z.string(), entries: z.array(bookValueBreakdownEntrySchema) })
  .openapi("BookValueBreakdown", {
    example: {
      symbol: "2330",
      entries: [
        { fiscalYear: 2025, openingBvps: 165.37, netIncome: 66.24, otherComprehensiveIncome: -2.18, cashDividends: -20.5, capitalIssued: 0, shareCountEffect: 0, other: 0.05, closingBvps: 208.99 },
      ],
    },
  });

registry.registerPath({
  method: "get",
  path: "/stocks/{symbol}/book-value-breakdown",
  summary: "查詢每股淨值的逐年變動拆解（瀑布圖用）",
  description:
    "資料來自 oingg-analysis-ts 的 GET /companies/book-value-breakdown（他們 2026-09-27 新增）。一年一列、由舊到新，單位是元／股。" +
    "**每一列是恆等式**：openingBvps 加上 netIncome、otherComprehensiveIncome、cashDividends、capitalIssued、shareCountEffect、other 六項等於 closingBvps。" +
    "**恆等式精確到分，不需要容差**（2026-09-27 抽 170 家、844 列實測，用整數分計算的殘差 844/844 都是 0）。" +
    "**驗它請寫 Math.round(sum * 100) === Math.round(closingBvps * 100)，不要寫 Math.abs(sum - closing) > 0.01**——後者在浮點下本身就不可用：0.01 存不進 binary float，殘差為零的列會算出 0.010000000000019327 之類的值而被誤判。" +
    "cashDividends 是**負值**（2330 的 2025 年度是 −20.5）。" +
    "shareCountEffect 跟 capitalIssued 是兩件事：前者是配股／分割／減資讓分母變了而權益總額沒變的那一塊，後者是現金增資、可轉債轉換這種真的有錢進來的。" +
    "other 是歸不進其他項的殘餘（庫藏股、非控制權益調整等），**外加恆等式的進位差額**——上游刻意讓這一欄吸收各項四捨五入後的差額（2026-09-27），換來恆等式精確到分。所以它不再保證是 0，但**只有 ±0.03 以內那一段分不出是進位差還是真調整**：實測 170 家 844 列，剛好 0 佔 31.2%、0 < |other| ≤ 0.03 佔 28.0%、**|other| > 0.03 佔 40.9%（這些是真的）**，大的一端可達 21.26（1256 的 2021）或佔期末每股淨值 39%（1235 的 2022），p50 0.01、p90 0.84、p99 5.87。所以不要一概把 other 非 0 當成進位差，四成是實質調整；也不建議加 |other| < 0.03 的門檻（會吃掉真的 0.02 調整，而那個量級在以元為單位的圖上本來就是次像素）。" +
    "所有欄位都是必填的數字、不會是 null（實測 40 家 197 列零個 null，上游也明確保證），所以缺欄位時 bff-ts 回 502 並指名欄位，不會靜默給 0。" +
    "沒有 limit 之類的參數，上游給全部年度（2330 是 7 列、5904 是 5 列）。查無資料回傳空陣列，不是 404。",
  tags: ["Stock"],
  request: { params: symbolParam },
  responses: {
    200: {
      description: "逐年的每股淨值變動拆解，查無資料時 entries 為空陣列。",
      content: { "application/json": { schema: bookValueBreakdownSchema } },
    },
    502: unauthorized502,
  },
});

const dailyPriceHistoryEntrySchema = z.object({
  tradeDate: z.string(),
  open: z.number().nullable().openapi({ description: NO_TRADE_DOC }),
  high: z.number().nullable().openapi({ description: NO_TRADE_DOC }),
  low: z.number().nullable().openapi({ description: NO_TRADE_DOC }),
  close: z.number().nullable().openapi({ description: NO_TRADE_DOC }),
  volume: z.number().openapi({ description: "成交量。**即使 OHLC 全是 null 也可能非 0**，所以不要用 volume 判斷當天有沒有成交。" }),
});

const dailyPriceHistorySchema = z
  .object({
    symbol: z.string(),
    entries: z.array(dailyPriceHistoryEntrySchema),
    earliestAvailableTradeDate: z.string().nullable(),
  })
  .openapi("DailyPriceHistory", {
    example: {
      symbol: "2330",
      entries: [
        { tradeDate: "2026-09-07", open: 2435, high: 2460, low: 2430, close: 2460, volume: 26898329 },
        { tradeDate: "2026-09-08", open: 2465, high: 2505, low: 2460, close: 2470, volume: 28931697 },
      ],
      earliestAvailableTradeDate: "2020-11-02",
    },
  });

registry.registerPath({
  method: "get",
  path: "/stocks/{symbol}/daily-price-history",
  summary: "查詢每日 OHLCV 股價歷史（股價走勢圖用）",
  description:
    "資料來自 oingg-analysis-ts 自己的 GET /stocks/:symbol/daily-price-history（2026-09-10 新增，跟 foreign-shareholding-history 同樣是 /stocks/:symbol/... 路徑形狀，不是 /companies/xxx-history?symbol=）。entries 是「舊到新」排序——注意跟 foreign-shareholding-history 的「新到舊」相反，不要因為路徑慣例相同就假設排序也相同。limit 是 1-2000，不給 limit 預設只回 250 筆，不是全部（實測 2330 不給 limit 回溯到 2025-08-28，共 250 筆）。這支端點沒有 total/hasMore 欄位，跟 foreign-shareholding-history 一樣。查無資料（代號不存在）回傳空陣列，不是 404。earliestAvailableTradeDate（2026-09-16 新增）是這檔股票資料庫裡最早的交易日，不受這次查詢的 limit 影響（實測 2330：不管 limit 怎麼設，這個欄位都固定回傳 2020-11-02）——設計目的是讓「大盤連動程度」這類多年區間切換圖表能精確算出某檔股票（例如近期上市公司）有沒有足夠的歷史資料，不用再用「250 交易日≈1 年」概估。查無任何價格資料時是 null。",
  tags: ["Stock"],
  request: {
    params: symbolParam,
    query: dailyPriceHistoryQuerySchema.openapi("DailyPriceHistoryQuery", { example: { limit: 250 } }),
  },
  responses: {
    200: {
      description: "每日 OHLCV 股價歷史，查無資料時 entries 為空陣列。",
      content: { "application/json": { schema: dailyPriceHistorySchema } },
    },
    400: errorResponse("limit 超出 1-2000 範圍。"),
    502: unauthorized502,
  },
});
