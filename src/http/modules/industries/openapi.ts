import { z } from "zod";
import { errorResponse, registry } from "@/http/swagger/registry.js";
import {
  sectorMetricHistoryQuerySchema,
  sectorMonthlyRevenueHistoryQuerySchema,
  sectorSummaryQuerySchema,
} from "@/http/modules/industries/route.js";

const securitiesSectorSchema = z.object({ sectorCode: z.string(), sectorName: z.string(), companyCount: z.number() });

const securitiesSectorListSchema = z
  .object({ sectors: z.array(securitiesSectorSchema) })
  .openapi("SecuritiesSectorList", {
    example: { sectors: [{ sectorCode: "24", sectorName: "半導體業", companyCount: 240 }] },
  });

const sectorMetricStatsSchema = z
  .object({
    count: z.number().int(),
    mean: z.number().nullable(),
    median: z.number().nullable(),
  })
  .openapi("SectorMetricStats", {
    description:
      "一個類股在一個指標上的統計。**count 是這裡最重要的欄位，不是附註**：它是「這個類股裡有多少家算得出這個指標」，而 mean／median 是對那 count 家算的，**不是對 companyCount 家算的**。count 為 0 時 mean 與 median 是 null（不會是 0）——2026-09-30 實測 34 個類股沒有任何一軸是 0，所以這條規則目前沒有活資料在驗證它，但不要省掉 null 處理。",
  });

const sectorDividendSummaryRowSchema = z.object({
  sectorCode: z.string(),
  sectorName: z.string(),
  companyCount: z.number().int(),
  dividendYield: sectorMetricStatsSchema,
  dividendGrowthRate3y: sectorMetricStatsSchema,
});

const sectorDividendSummarySchema = z
  .object({
    dividendYieldTradeDate: z.string().nullable(),
    sectors: z.array(sectorDividendSummaryRowSchema),
  })
  .openapi("SectorDividendSummary", {
    example: {
      dividendYieldTradeDate: "2026-09-30",
      sectors: [
        { sectorCode: "01", sectorName: "水泥工業", companyCount: 7, dividendYield: { count: 7, mean: 5.48, median: 6.44 }, dividendGrowthRate3y: { count: 7, mean: 2.9, median: 7.72 } },
      ],
    },
  });

registry.registerPath({
  method: "get",
  path: "/industries/securities-sectors",
  summary: "查詢證交所類股分類清單（供 screener 的 sectorCodes 篩選使用）",
  description:
    "這裡是證交所/櫃買中心自己的類股代碼（例如「24」是半導體業），二碼代號，沒有樹狀階層。回傳的 code 可直接用在 POST /screener 跟 GET /screener/ranking 的 sectorCodes 參數，多個代碼是聯集（OR），再跟其他篩選條件 AND。沒有查詢參數，一次回傳全部類股。**`companyCount` 的母體（2026-10-01 上游修正後的定義）＝「用這個代碼在 screener 篩得到幾家」，跟 `GET /stocks` 相同（上市＋上櫃＋**含興櫃**，不含公開發行未上市），轉板公司只算一次。** 實測 34 個類股、合計 2,339，與 `GET /stocks` 裡 sectorCode 有值的家數逐類股零筆不符。**修正前它不是這個意思**：上市那一側沒有過濾 source，把約 305 家「公開發行未上市」也算進去，於是合計 2,594、而代號 13 的 33 家全部是這種公司（點進去篩不到任何東西）。如果你看到舊的數字，差異來源是這個。**要「排除興櫃」的家數請改用 `GET /industries/sector-dividend-summary` 的 `companyCount`**（實測逐類股相符、合計 1,976；差額就是 363 家興櫃——2026-10-02 起上游把 10 檔 DR 移出目錄，所以不再有「sectorCode 為 null」那一項，而 securities-sectors 的 34 類加總正好等於目錄的上市櫃家數）——但那是上游目前的母體選擇而不是契約，拿它當第二來源對帳比直接依賴它安全。**代號 13（電子工業（舊分類））與 19（綜合）2026-10-01 起不再列出**，因為它們篩不到任何公司；但 `sectorCodes` 仍然接受它們，不會變 400，只會篩出 0 家——所以使用者存過的篩選條件不會壞。",
  tags: ["Industries"],
  responses: {
    200: { description: "全部證交所類股清單。", content: { "application/json": { schema: securitiesSectorListSchema } } },
    502: errorResponse("analysis-ts 服務無法連線或回應格式異常。"),
  },
});

registry.registerPath({
  method: "get",
  path: "/industries/sector-dividend-summary",
  summary: "查詢各類股的股利統計（殖利率、三年股利成長率的家數／平均／中位數），供產業分析散佈圖使用",
  description:
    "資料來自 oingg-analysis-ts 的 GET /industries/sector-dividend-summary（2026-09-30 新增）。沒有查詢參數，一次回傳全部類股，依 sectorCode 排序；sectorCode 就是 GET /industries/securities-sectors 的 code（證交所類股，不是財政部稅籍分類）。母體是上市加上櫃、不含興櫃，2026-09-30 實測 34 個類股、companyCount 合計 1,976（跟全市場目錄 2,339 不同，別當同一個母體比較；差額是 363 家興櫃）。dividendYieldTradeDate 是殖利率取自哪一天的收盤，整份回應共用一個日期、不是逐類股。" +
    "**這支端點要畫成散佈圖之前有三件事必須處理，全部是 2026-09-30 對 34 個類股的實測，而且從單看一列的資料是看不出來的：**" +
    "**(1) 兩個軸的 count 不同，所以一個點的 x 與 y 是對不同子母體算的，而稀疏的那一軸是成長率。** 殖利率軸的涵蓋率中位數是 100%、最低 98%、31/34 類股全滿（2026-09-30 晚間實測；**這是常態、不會退回去**——這支端點上線後第一個小時有個暫時規則「殖利率只算大於 0」，那段時間量到的低涵蓋率是規則的產物不是真實狀態，見 (4)）；成長率軸則是綠能環保 n=5/46、油電燃氣業 n=2/12、數位雲端 n=8/40、半導體業 n=120/206。兩軸都有值的涵蓋率中位數 61.4%、最低 10.9%，10 個類股的成長率 n<10，而油電燃氣業那 2 家的平均是 -45.87。把 n=2 的點跟 n=120 的點畫成同樣大小、同等權重會誤導——**請用 count 做透明度、點大小或最小 n 門檻**。門檻取捨（實測）：n>=5 留 32 個類股、n>=10 留 24 個、n>=20 留 19 個、n>=30 留 13 個。唯一兩軸皆 100% 的是水泥工業（7/7）。" +
    "**(2) mean 與 median 在成長率這一軸有 7 個類股正負號相反**（食品工業、電機機械、建材營造業、電子零組件業、其他電子業、文化創意業、運動休閒），而成長率的正負號就是它要講的整句話（配息在成長還是在縮）。所以選 mean 還是 median 不是美觀問題，會對 34 個類股裡的 7 個給出**相反的結論**。少數極端值就足以翻轉 mean：造紙工業 mean -60.40／median -44.97、玻璃陶瓷 -20.28／-3.45、橡膠工業 -24.82／-10.61。要描述「這個類股典型的樣子」請用 median。" +
    "**(3) companyCount 不是 mean/median 的分母。** 它是類股的公司家數，各軸自己的 count 才是。拿 companyCount 當分母去反推總額會算錯。" +
    "**(4) 殖利率的 0 代表「不配息」，而它是母體的四分之一。** 證交所從 2026-08-28 起對不配息的上市公司改成**不填**殖利率（之前填 0.00），analysis-ts 於 2026-09-30（commit c70cf5a0）把 8/28 起的空白讀成 0，所以原本是 null 的公司現在是 0。實測：殖利率恰為 0 的有 **516 家（母體 1,978 的 26%，TPEx 279 + TWSE 236）**，screener 分布端點的 p20 變成 0，而 **34 個類股的殖利率 mean 全部下移**，平均 -0.97 個百分點、最多 -2.59（文化創意業 6.11→3.52），移動最大的是不配息最多的類股（生技醫療業 n 95→159、mean 4.26→2.54）。" +
    "**這個方向是對的而不是壞掉**——先前「生技醫療業平均殖利率 4.26%」是只對會配息的 95 家算的、忽略不配息的 64 家，2.54% 才是這個類股典型的殖利率。但它是**另一個量**，而且 formulaVersion 不升（取數規則變更不升版），所以快取過舊值的人只會看到數字無聲變小，請清掉殖利率相關的快取。另外 **0 與「算不出來」現在無法區分**：0% 是完全合理的座標值、不會長得像缺值，所以貼著 y 軸那一排點是「不配息」而不是資料有問題。造紙工業的殖利率 median 就是 0（7 家裡過半不配息），那個類股的點會落在軸上。" +
    "bff-ts 這邊不做任何計算（代理端點零轉換），也不快取，每次即時轉發。",
  tags: ["Industries"],
  responses: {
    200: { description: "全部類股的股利統計。", content: { "application/json": { schema: sectorDividendSummarySchema } } },
    502: errorResponse("analysis-ts 服務無法連線或回應格式異常。"),
  },
});

const sectorCodeParam = z.object({ sectorCode: z.string().openapi({ example: "24", description: "證交所類股代碼（見 GET /industries/securities-sectors）" }) });
const statsSchema = z.object({ count: z.number(), median: z.number().nullable(), q1: z.number().nullable(), q3: z.number().nullable() });

registry.registerPath({
  method: "get",
  path: "/industries/{sectorCode}/metric-history",
  summary: "類股的指標分布歷史（中位數與四分位數）",
  description:
    "analysis-ts 的 GET /industries/{sectorCode}/metric-history 原樣轉發（2026-10-09 起）。每一期是同一期對齊、排除興櫃的上市櫃公司在這支指標上的 median／q1／q3 與家數。" +
    "**只收季報型、非每股類指標**：每股類（eps 等）跨公司取中位數沒有意義，上游回 400。basis 對應上游的 timeframe（Q／TTM／FY，由上游驗）。" +
    "entries 由舊到新；limit 1～40，不給時上游預設 20。整個類股算不出分布時那一期的 median 等是 null，nullReason 說明原因（例如金控的三率是 not_applicable_industry）。",
  tags: ["Industries"],
  request: { params: sectorCodeParam, query: sectorMetricHistoryQuerySchema },
  responses: {
    200: {
      description: "類股指標分布歷史。",
      content: {
        "application/json": {
          schema: z.object({
            sectorCode: z.string(),
            sectorName: z.string(),
            metricCode: z.string(),
            timeframe: z.string(),
            entries: z.array(statsSchema.extend({ fiscalYear: z.number(), fiscalQuarter: z.number().nullable(), nullReason: z.string().nullable() })),
          }).openapi("SectorMetricHistory"),
        },
      },
    },
    400: errorResponse("缺 metricCode／basis、limit 超出 1～40，或上游拒絕這支指標（code: unknown_metric、unsupported_timeframe、per_share_not_aggregatable）。"),
    404: errorResponse("類股代碼查無上市櫃公司（code: unknown_sector）。上游路由不存在（部署落後）是 502，不是這個 404。"),
    502: errorResponse("analysis-ts 服務無法連線或回應格式異常。"),
  },
});

registry.registerPath({
  method: "get",
  path: "/industries/{sectorCode}/monthly-revenue-history",
  summary: "類股月營收歷史（同一批公司的年增率）",
  description:
    "analysis-ts 的 GET /industries/{sectorCode}/monthly-revenue-history 原樣轉發（2026-10-09 起）。年增率用同一批公司計算。" +
    "currentMonthRevenue／lastYearSameMonthRevenue 是新台幣千元的字串（2026-10-10 起的統一用語欄名）。limit 1～132（2026-10-10 前是 120），不給時上游預設 60；**起點看第一筆的 yearMonth**（上游正在往 2016-01 回補）；total／hasMore 意義同其他歷史端點。",
  tags: ["Industries"],
  request: { params: sectorCodeParam, query: sectorMonthlyRevenueHistoryQuerySchema },
  responses: {
    200: {
      description: "類股月營收歷史。",
      content: {
        "application/json": {
          schema: z.object({
            sectorCode: z.string(),
            sectorName: z.string(),
            total: z.number(),
            hasMore: z.boolean(),
            entries: z.array(z.object({
              yearMonth: z.string(),
              currentMonthRevenue: z.string().nullable(),
              lastYearSameMonthRevenue: z.string().nullable(),
              yoyChangePct: z.number().nullable(),
              companyCount: z.number(),
            })),
          }).openapi("SectorMonthlyRevenueHistory"),
        },
      },
    },
    400: errorResponse("limit 超出 1～132。"),
    404: errorResponse("類股代碼查無上市櫃公司（code: unknown_sector）。上游路由不存在（部署落後）是 502，不是這個 404。"),
    502: errorResponse("analysis-ts 服務無法連線或回應格式異常。"),
  },
});

registry.registerPath({
  method: "get",
  path: "/industries/sector-summary",
  summary: "各類股的指標分布摘要",
  description:
    "analysis-ts 的 GET /industries/sector-summary 原樣轉發（2026-10-09 起）。fields 是逗號分隔的欄位（\"roe.TTM,grossMargin.Q\"），最多 10 個（上游驗）。" +
    "每個類股回 companyCount 與每個欄位的 count／median／q1／q3。",
  tags: ["Industries"],
  request: { query: sectorSummaryQuerySchema },
  responses: {
    200: {
      description: "各類股摘要。",
      content: {
        "application/json": {
          schema: z.object({
            sectors: z.array(z.object({
              sectorCode: z.string(),
              sectorName: z.string(),
              companyCount: z.number(),
              fields: z.record(z.string(), statsSchema),
            })),
          }).openapi("SectorSummary"),
        },
      },
    },
    400: errorResponse("缺 fields 或超過 10 個。"),
    502: errorResponse("analysis-ts 服務無法連線或回應格式異常。"),
  },
});
