import { z } from "zod";
import { errorResponse, registry } from "@/http/swagger/registry.js";
import { industryTreeQuerySchema } from "@/http/modules/industries/route.js";

const industryLevelSchema = z.enum(["section", "division", "group", "class", "subclass"]);

const industryTreeChildSchema = z.object({
  code: z.string(),
  level: industryLevelSchema,
  name: z.string(),
  companyCount: z.number(),
  hasChildren: z.boolean(),
});

const industryTreeCompanySchema = z.object({ symbol: z.string(), companyName: z.string() });

const industryTreeSchema = z
  .object({
    found: z.boolean(),
    code: z.string().nullable(),
    level: industryLevelSchema.nullable(),
    name: z.string().nullable(),
    companyCount: z.number(),
    children: z.array(industryTreeChildSchema),
    companies: z.array(industryTreeCompanySchema),
  })
  .openapi("IndustryTree", {
    example: {
      found: true,
      code: "C",
      level: "section",
      name: "製造業",
      companyCount: 587,
      children: [{ code: "08", level: "division", name: "食品及飼品製造業", companyCount: 13, hasChildren: true }],
      companies: [],
    },
  });

const industryTreeQueryDocSchema = industryTreeQuerySchema.openapi("IndustryTreeQuery", {
  example: { code: "C" },
});

registry.registerPath({
  method: "get",
  path: "/industries/tree",
  summary: "查詢產業分類樹（財政部稅籍五層分類：section→division→group→class→subclass）",
  description:
    "code 是任一層級的分類代碼，全域唯一，不用另外指定層級——伺服器自己判斷屬於哪一層。省略 code 回傳樹根（19 個 section，此時 code/level/name 為 null）。companyCount 是該節點含所有子孫節點的公司數加總，每一層都有意義，可用來判斷分支值不值得展開；有些 section 的 companyCount 是 0 但 hasChildren 仍是 true（字典本身有子節點，只是目前沒有公司分類在裡面）。companies 只有在 subclass 這個最細層級才會非空——999 家已追蹤公司全部分類在 subclass，中間層級（section/division/group/class）的 companies 固定是空陣列，避免同一家公司在每一層都重複出現；UI 應該用 children 逐層展開，展開到 subclass 才顯示 companies。查無此分類代碼時 found 是 false，code 會照原樣回傳查詢值，其餘欄位跟正常節點同一個 shape（level/name 為 null、children/companies 為空陣列、companyCount 為 0），不是拋錯。範圍限定在 999 家 gov-ts 已追蹤稅籍分類的公司，不含 KY（境外註冊）股——那些公司沒有台灣稅籍可以分類。",
  tags: ["Industries"],
  request: { query: industryTreeQueryDocSchema },
  responses: {
    200: { description: "分類樹節點（含子節點清單跟／或公司清單）。", content: { "application/json": { schema: industryTreeSchema } } },
    502: errorResponse("analysis-ts 服務無法連線或回應格式異常。"),
  },
});

const industryPathNodeSchema = z.object({ code: z.string(), level: industryLevelSchema, name: z.string() });

const industryFlatCompanySchema = z.object({
  symbol: z.string(),
  companyName: z.string(),
  path: z.array(industryPathNodeSchema),
});

const industryFlatListSchema = z
  .object({ companies: z.array(industryFlatCompanySchema) })
  .openapi("IndustryFlatList", {
    example: {
      companies: [
        {
          symbol: "2330",
          companyName: "台積電",
          path: [
            { code: "C", level: "section", name: "製造業" },
            { code: "26", level: "division", name: "電子零組件製造業" },
            { code: "261", level: "group", name: "半導體製造業" },
            { code: "2611", level: "class", name: "積體電路製造業" },
            { code: "2611-99", level: "subclass", name: "其他積體電路製造" },
          ],
        },
      ],
    },
  });

const securitiesSectorSchema = z.object({ code: z.string(), name: z.string(), companyCount: z.number() });

const securitiesSectorListSchema = z
  .object({ sectors: z.array(securitiesSectorSchema) })
  .openapi("SecuritiesSectorList", {
    example: { sectors: [{ code: "24", name: "半導體業", companyCount: 240 }] },
  });

registry.registerPath({
  method: "get",
  path: "/industries/securities-sectors",
  summary: "查詢證交所類股分類清單（供 screener 的 sectorCodes 篩選使用）",
  description:
    "跟上面的 GET /industries/tree（財政部稅籍五層分類）是完全不同的分類體系——這裡是證交所/櫃買中心自己的類股代碼（例如「24」是半導體業），二碼代號，沒有樹狀階層。回傳的 code 可直接用在 POST /screener 跟 GET /screener/ranking 的 sectorCodes 參數，多個代碼是聯集（OR），再跟其他篩選條件 AND。沒有查詢參數，一次回傳全部類股。",
  tags: ["Industries"],
  responses: {
    200: { description: "全部證交所類股清單。", content: { "application/json": { schema: securitiesSectorListSchema } } },
    502: errorResponse("analysis-ts 服務無法連線或回應格式異常。"),
  },
});

registry.registerPath({
  method: "get",
  path: "/industries/flat",
  summary: "一次取得全部已分類公司的 symbol → 完整分類路徑，供前端自建搜尋索引",
  description:
    "GET /industries/tree 的攤平版——沒有查詢參數，一次回傳所有 999 家 gov-ts 已追蹤公司的完整路徑（由粗到細：section→division→group→class→subclass，每層都帶 code/level/name），不用為了做「股票代號搜尋」或「分類名稱關鍵字搜尋」而遞迴打 GET /industries/tree 建索引。範圍/涵蓋公司跟 GET /industries/tree 一致（目前只有上市公司有資料，上櫃/興櫃待 gov-ts 補齊，補齊後這支端點會自動反映，不用改介面）。analysis-ts 這支端點讀的是常駐記憶體快取，沒有額外 DB 查詢成本，bff-ts 這邊也不另外快取，每次都是即時轉發。",
  tags: ["Industries"],
  responses: {
    200: { description: "全部已分類公司的 symbol → 完整路徑清單。", content: { "application/json": { schema: industryFlatListSchema } } },
    502: errorResponse("analysis-ts 服務無法連線或回應格式異常。"),
  },
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
  path: "/industries/sector-dividend-summary",
  summary: "查詢各類股的股利統計（殖利率、三年股利成長率的家數／平均／中位數），供產業分析散佈圖使用",
  description:
    "資料來自 oingg-analysis-ts 的 GET /industries/sector-dividend-summary（2026-09-30 新增）。沒有查詢參數，一次回傳全部類股，依 sectorCode 排序；sectorCode 就是 GET /industries/securities-sectors 的 code（證交所類股，不是財政部稅籍分類）。母體是上市加上櫃、不含興櫃，2026-09-30 實測 34 個類股、companyCount 合計 1,976（跟全市場 2,349 不同，別當同一個母體比較；差額主要是 363 家興櫃）。dividendYieldTradeDate 是殖利率取自哪一天的收盤，整份回應共用一個日期、不是逐類股。" +
    "**這支端點要畫成散佈圖之前有三件事必須處理，全部是 2026-09-30 對 34 個類股的實測，而且從單看一列的資料是看不出來的：**" +
    "**(1) 兩個軸的 count 不同，所以一個點的 x 與 y 是對不同子母體算的，而稀疏的那一軸是成長率。** 殖利率軸的涵蓋率中位數是 100%、最低 98%、31/34 類股全滿（2026-09-30 晚間實測，當天上游改過殖利率的空白處理，見 (4)）；成長率軸則是綠能環保 n=5/46、油電燃氣業 n=2/12、數位雲端 n=8/40、半導體業 n=120/206。兩軸都有值的涵蓋率中位數 61.4%、最低 10.9%，10 個類股的成長率 n<10，而油電燃氣業那 2 家的平均是 -45.87。把 n=2 的點跟 n=120 的點畫成同樣大小、同等權重會誤導——**請用 count 做透明度、點大小或最小 n 門檻**。門檻取捨（實測）：n>=5 留 32 個類股、n>=10 留 24 個、n>=20 留 19 個、n>=30 留 13 個。唯一兩軸皆 100% 的是水泥工業（7/7）。" +
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
