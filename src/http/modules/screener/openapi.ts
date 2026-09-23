import { z } from "zod";
import { errorResponse, registry } from "@/http/swagger/registry.js";
import {
  companyRankQuerySchema,
  distributionQuerySchema,
  rankingQuerySchema,
  screenerRequestSchema,
  screenerValuesRequestSchema,
} from "@/http/modules/screener/route.js";

const upstream502 = errorResponse("analysis-ts 服務無法連線或回應格式異常。");

const screenerValueSchema = z.object({
  value: z.unknown().nullable(),
  knowledgeDate: z.string().nullable(),
  nullReason: z.string().nullable(),
});

const screenerColumnSchema = z.object({
  field: z.string(),
  metricName: z.string(),
  fieldName: z.string(),
  unit: z.string().nullable().optional(),
});

const screenerResultRowSchema = z.object({
  symbol: z.string(),
  name: z.string().nullable().optional(),
  values: z.record(z.string(), screenerValueSchema),
});

const screenerRequestDocSchema = screenerRequestSchema.openapi("ScreenerRequest", {
  example: {
    filters: [{ field: "grossMargin.TTM", min: 20, max: null, exclude: false }],
    page: 1,
    pageSize: 50,
  },
});

const screenerResultSchema = z
  .object({
    count: z.number(),
    page: z.number(),
    pageSize: z.number(),
    totalPages: z.number(),
    columnPresetId: z.string().nullable(),
    columns: z.array(screenerColumnSchema),
    results: z.array(screenerResultRowSchema),
  })
  .openapi("ScreenerResult", {
    example: {
      count: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
      columnPresetId: null,
      columns: [{ field: "exchangePeRatio.EOD", metricName: "exchangePeRatio", fieldName: "EOD", unit: null }],
      results: [{ symbol: "2330", values: { "exchangePeRatio.EOD": { value: "27.82", knowledgeDate: "2026-08-16", nullReason: null } } }],
    },
  });

registry.registerPath({
  method: "post",
  path: "/screener",
  summary: "依 filterCatalog 指標篩選個股",
  description:
    "不需要登入即可使用（僅儲存為具名 preset 才需要，見 POST /screener/presets）。field 格式為 \"<metricCode>.<token>\"（例如 \"grossMargin.TTM\"、\"beta.2Y_1W\"），對應 GET /metrics 每個 metricCode 底下的 validTokens 陣列——務必用 validTokens，部分指標（例如 beta）的可用 token 不是任意組合，只有特定值才有資料。metricName 從 2026-09-09 起是 analysis-ts 提供的真實中文名稱（例如「殖利率（交易所公告）」），fieldName 目前仍是 token 本身（analysis-ts 還沒有針對個別 token 的文案）。每個指標會取該股票最新一筆合併報表（非子公司）的數值來比對，不同指標之間用 AND 合併。**「最新一筆」是逐公司認定的，不是全市場對齊到同一季**：財報進度不同，有些公司最新列已是 2026Q2、有些還停在 2026Q1 或更早，同一次查詢的結果會混合不同財報期別（每列的 knowledgeDate 就是該列的實際期別依據）。因此 count 的意思是「最新可得數值符合條件的公司數」，不是「在某一季全部符合條件的公司數」——要回答後者請用固定季別的歷史端點，不要拿這裡的 count 當某季的統計（analysis-ts 2026-09-22 就是用嚴格 fiscal_quarter=2 統計覆蓋率，比這裡的 count 少了 7 家）。sectorCodes 是選填的證交所類股代碼陣列（見 GET /industries/securities-sectors），多個代碼是聯集（OR），再跟 filters 的結果 AND；excludeSectorCodes（2026-09-20 新增）跟 sectorCodes 對稱，篩選「排除這些類股以外的全部」，兩者互斥（都給且都非空會 400，空陣列視為沒給）——analysis-ts 端是真的 NOT IN 查詢，不是前端或 bff-ts 反向組出其餘類股清單（後者會讓存起來的 preset 語意跟使用者原意不符：新增類股代碼時「排除 X」的 preset 會被誤解成「只包含目前這些」，詳見 excludeSectorCodes 的討論記錄）。**未分類公司的語意差異**：目前約 51 家沒有證交所類股代碼的公司，用 sectorCodes 篩選時會被排除在外（因為不屬於任何指定類股），用 excludeSectorCodes 篩選時則會被保留（因為它們不屬於任何被排除的類股）——這不是 bug，是「包含」跟「排除」語意上的自然結果，存 preset 時請注意這個差異。這裡的 sectorCodes/excludeSectorCodes 只影響這次查詢本身，若要讓某組已儲存的篩選組合記住類股條件，請用 POST/PATCH /screener/presets 上同名的欄位。顯示欄位由 columnPresetId 或 columns 其中一個決定，兩者互斥（都給會 400）：columnPresetId 是已登入使用者自己的 ColumnPreset id（見 GET /screener/column-presets）——未登入請求帶 columnPresetId 會被忽略，一律當作沒給；columns 是原始欄位 key 陣列（跟 field 格式一樣，例如 ColumnPresetTemplate 的 fieldKeys，見 GET /screener/column-preset-templates），不需要登入、不需要先建立任何個人資源，這是訪客／一次性查詢唯一能指定顯示欄位的方式。兩者都沒給的話：已登入就用該帳號自己設的預設欄位組合，找不到就用系統內建的常用欄位；未登入一律套用系統內建欄位。回應的 columnPresetId 會標明實際套用的是哪一組（null 代表用的是系統內建，或這次是用 columns 直接指定）。每個 results[].values 底下的欄位都是 { value, knowledgeDate, nullReason } 物件，不是純值。knowledgeDate 統一是實際日期字串（\"YYYY-MM-DD\"，knowledge date，2026-09-13 起由 asOfDate 更名，語意是「這個值哪天被市場公告知道」）；value 為 null 時 nullReason 會是 missing_input/zero_or_negative_denominator/not_applicable_industry/insufficient_history 四選一（跟 metric-history 系列端點同一套），value 有值或來源沒有分類原因時 nullReason 為 null（例如 stock.price 特殊欄位）。**value 為 null 時，有沒有 nullReason 是兩件不同的事，前端文案請分開處理**：nullReason 有值代表「資料在，但這個指標算不出來」（例如 zero_or_negative_denominator＝自由現金流為零或負，比率無意義），應該顯示「無法計算」並把原因說清楚——這本身就是關於這家公司的事實；nullReason 為 null 才是「我們沒有這家公司的數字」，顯示「尚無資料」。把前者印成「尚無資料」會誤導讀者（web-nuxt 2026-09-22 實際踩到，1101 的 fcfConversionRate 連續四季被印成「尚無資料」）。",
  tags: ["Screener"],
  security: [{ bearerAuth: [] }, {}],
  request: { body: { required: true, content: { "application/json": { schema: screenerRequestDocSchema } } } },
  responses: {
    200: {
      description: "符合條件的股票清單（這一頁的部分），附上總筆數/頁碼/總頁數，以及實際套用的 columnPresetId。",
      content: { "application/json": { schema: screenerResultSchema } },
    },
    400: errorResponse("請求格式錯誤，field 不存在於 filterCatalog，page/pageSize 不合法，columnPresetId 和 columns 同時給了，或 sectorCodes 和 excludeSectorCodes 同時給了。"),
    401: errorResponse("帶了 Authorization header，但 token 無效或過期（完全不帶則視為匿名請求，不會 401）。"),
    404: errorResponse("指定的 columnPresetId 不存在，或不屬於目前登入的使用者。"),
    502: upstream502,
  },
});

const screenerValuesRequestDocSchema = screenerValuesRequestSchema.openapi("ScreenerValuesRequest", {
  example: { symbols: ["2330", "2317"], columns: [{ field: "roe.TTM" }] },
});

const screenerValuesResultSchema = z
  .object({
    count: z.number(),
    columns: z.array(screenerColumnSchema),
    results: z.array(screenerResultRowSchema),
  })
  .openapi("ScreenerValuesResult", {
    example: {
      count: 2,
      columns: [{ field: "roe.TTM", metricName: "roe", fieldName: "TTM", unit: null }],
      results: [
        { symbol: "2330", name: "台積電", values: { "roe.TTM": { value: "34.78", knowledgeDate: "2026-08-11", nullReason: null } } },
        { symbol: "2317", name: "鴻海", values: { "roe.TTM": { value: "11.15", knowledgeDate: "2026-06-30", nullReason: null } } },
      ],
    },
  });

registry.registerPath({
  method: "post",
  path: "/screener/values",
  summary: "針對一批已知的股票代號，只查詢指定的欄位——不篩選、不分頁",
  description:
    "給前端「已經顯示一批股票，現在要多加一欄」這種情境用：不用把整個帶篩選條件、分頁的 POST /screener 重打一次，只需要帶 symbols 跟這次要新增的 columns。field 格式、回應的 values 形狀都跟 POST /screener 一致。symbols 裡的每一個代號都保證會出現在 results 裡（就算 analysis-ts 查無資料，也是回 values 為空物件的那一列，不會整列消失）。symbols 上限 200 個。count 固定等於 results.length，附上這個欄位是為了讓前端既有的分頁元件不用特別為這支端點做例外處理。",
  tags: ["Screener"],
  request: { body: { required: true, content: { "application/json": { schema: screenerValuesRequestDocSchema } } } },
  responses: {
    200: { description: "每個 symbols 裡的代號都會有一列結果。", content: { "application/json": { schema: screenerValuesResultSchema } } },
    400: errorResponse("symbols/columns 格式錯誤、其中一個 field 不存在於 filterCatalog，或 symbols 超過 200 個。"),
    502: upstream502,
  },
});

const rankingQueryDocSchema = rankingQuerySchema.openapi("ScreenerRankingQuery", {
  example: { field: "dividendYield.EOD", direction: "desc", limit: 10 },
});

const rankingResultSchema = z
  .object({
    field: z.string(),
    direction: z.enum(["asc", "desc"]),
    columns: z.array(screenerColumnSchema),
    results: z.array(screenerResultRowSchema),
  })
  .openapi("ScreenerRankingResult", {
    example: {
      field: "roe.TTM",
      direction: "desc",
      columns: [{ field: "roe.TTM", metricName: "roe", fieldName: "TTM", unit: null }],
      results: [{ symbol: "2330", values: { "roe.TTM": { value: "34.78", knowledgeDate: "2026-08-11", nullReason: null } } }],
    },
  });

registry.registerPath({
  method: "get",
  path: "/screener/ranking",
  summary: "依單一指標排行（例如殖利率最高、本益比最低）——給首頁卡片用，不是完整篩選",
  description:
    "不需要登入。只依 field 這一個指標排序，沒有門檻條件，direction=asc 由小到大、direction=desc（預設）由大到小。排行欄位本身一定會被排除 null（沒有這個數字的公司不會出現），也一定會出現在回傳的 columns/values 裡；columns 可以額外加逗號分隔的顯示欄位（含 \"stock.price\"）。sectorCodes 是選填的逗號分隔證交所類股代碼（見 GET /industries/securities-sectors），多個代碼是聯集（OR）；excludeSectorCodes（2026-09-20 新增）跟 sectorCodes 對稱、同樣是逗號分隔字串，篩選「排除這些類股以外的全部」，兩者互斥（都給會 400）——語意跟未分類公司的處理方式跟 POST /screener 完全一致，見該端點文件。兩者都僅限一般排行路徑：exchangePeRatio.EOD／exchangePbRatio.EOD／dividendYield.EOD 這三個特例欄位是走 analysis-ts 另一支估值排行端點，沒有類股篩選能力，帶了 sectorCodes 或 excludeSectorCodes 都會回 400。results[].values 底下每個欄位都是 { value, knowledgeDate, nullReason } 物件，shape 跟 POST /screener 一致。",
  tags: ["Screener"],
  request: { query: rankingQueryDocSchema },
  responses: {
    200: {
      description: "排行結果（不分頁，就是前 limit 名）。knowledgeDate 統一是實際日期字串（\"YYYY-MM-DD\"，knowledge date）。",
      content: { "application/json": { schema: rankingResultSchema } },
    },
    400: errorResponse("缺少 field，field 不存在於 filterCatalog，direction/limit/columns 格式錯誤，或 sectorCodes 和 excludeSectorCodes 同時給了。"),
    502: upstream502,
  },
});

const companyRankQueryDocSchema = companyRankQuerySchema.openapi("CompanyRankQuery", {
  example: { symbol: "2330", field: "dividendYield.EOD", direction: "desc" },
});

const companyRankResultSchema = z
  .object({
    symbol: z.string(),
    field: z.string(),
    found: z.boolean(),
    value: z.number().nullable(),
    rank: z.number().nullable(),
    totalCount: z.number().nullable(),
    topPercent: z.number().nullable(),
    quintile: z.number().nullable(),
  })
  .openapi("CompanyRankResult", {
    example: { symbol: "2330", field: "dividendYield.EOD", found: true, value: 0.92, rank: 1152, totalCount: 1583, topPercent: 72.8, quintile: 2 },
  });

registry.registerPath({
  method: "get",
  path: "/screener/company-rank",
  summary: "查單一公司在全市場某個欄位的排名/百分位——跟 ranking 互補（ranking 是「前幾名是誰」，這支是「這家公司排第幾」）",
  description:
    "不需要登入。symbol/field/direction 三者都必填，沒有預設值（跟 GET /screener/ranking 的 direction 有預設不同，這支省略 direction 會回 400）。field 格式跟其他 screener 端點一致（\"<metricCode>.<token>\"）。rank 是 1-based，並列數值共用同一個名次（RANK() 語意，所以下一個名次可能不連續）。totalCount 只計入這個欄位有值（非 null）的公司數。excludeZero（2026-09-24 新增）是選填的布林值（\"true\"/\"false\"），true 時把該欄位剛好等於 0 的公司排除在母體之外，省略或 false 都不排除。對殖利率這類欄位差別很大：不配息的公司殖利率是 0，不排除的話「**有配息公司中**的排名」會被它們稀釋（實測 dividendYield.EOD 母體 1,723 vs 1,445）。它只影響 totalCount／topPercent，**rank 不變**——被排除的零值在降冪排序裡本來就排在後面。前端若要在文案上宣稱「有配息公司中」，必須帶 excludeZero=true，否則那句話與數字不符。quintile（2026-09-24 接上，analysis-ts 其實早就有送、被 bff-ts 的欄位逐一正規化靜默丟掉）是這家公司落在母體的第幾個五等分（1–5），方向跟 direction 一致（desc 時 5 最好）。**不要自己用 topPercent 推**：並列名次共用同一個 rank（RANK() 語意），analysis-ts 的 quintile 是對真實分布切的，不是 rank÷totalCount。found 為 false 時是 null。topPercent = rank÷totalCount×100（四捨五入到小數點後一位）——數字越小代表排名越前面（例如 5 代表排在全市場前 5%），跟一般認知的「百分位」方向相反，不要混淆。查無資料（這個欄位對這家公司從沒算過，或算出來是 null，或代號不存在）時 found 為 false，value/rank/totalCount/topPercent 全部是 null，仍是 200，不是 404。",
  tags: ["Screener"],
  request: { query: companyRankQueryDocSchema },
  responses: {
    200: {
      description: "這家公司在該欄位的排名結果，查無資料時 found 為 false、其餘欄位皆為 null。",
      content: { "application/json": { schema: companyRankResultSchema } },
    },
    400: errorResponse("缺少 symbol/field/direction 任一個，或 field 不存在於 filterCatalog。"),
    502: upstream502,
  },
});

const distributionQueryDocSchema = distributionQuerySchema.openapi("DistributionQuery", {
  example: { field: "dividendYield.EOD", bins: 20, excludeZero: true },
});

const distributionBinSchema = z.object({
  min: z.number(),
  max: z.number(),
  count: z.number(),
});

const distributionResultSchema = z
  .object({
    field: z.string(),
    totalCount: z.number(),
    trueMin: z.number(),
    trueMax: z.number(),
    clippedMin: z.number(),
    clippedMax: z.number(),
    bins: z.array(distributionBinSchema),
  })
  .openapi("DistributionResult", {
    example: {
      field: "dividendYield.EOD",
      totalCount: 1583,
      trueMin: 0,
      trueMax: 18.2,
      clippedMin: 0,
      clippedMax: 12,
      bins: [
        { min: 0, max: 0.6, count: 214 },
        { min: 0.6, max: 1.2, count: 358 },
      ],
    },
  });

registry.registerPath({
  method: "get",
  path: "/screener/distribution",
  summary: "查單一欄位在全市場的分布直方圖——給股票詳情頁的市場排名圖表用（例如現金殖利率的市場排名）",
  description:
    "不需要登入。field 格式跟其他 screener 端點一致（\"<metricCode>.<token>\"），欄位驗證交給 analysis-ts。bins 是選填的分桶數量（正整數），省略時用 analysis-ts 自己的預設值。excludeZero 是選填的布林值（\"true\"/\"false\"，2026-09-18 由 analysis-ts 新增），true 時會在分桶前先排除該欄位剛好等於 0 的資料列，省略時等同 false。totalCount 只計入這個欄位有值（非 null，且未被 excludeZero 排除）的公司數。trueMin/trueMax 是全市場這個欄位實際的最小/最大值；clippedMin/clippedMax 是 bins 實際涵蓋的範圍（analysis-ts 可能會先裁掉極端離群值再分桶，詳細規則以他們的端點為準）。bins 陣列每一格是 { min, max, count }。",
  tags: ["Screener"],
  request: { query: distributionQueryDocSchema },
  responses: {
    200: {
      description: "這個欄位在全市場的分布直方圖。",
      content: { "application/json": { schema: distributionResultSchema } },
    },
    400: errorResponse("缺少 field，field 不存在於 filterCatalog，或 bins/excludeZero 格式錯誤。"),
    502: upstream502,
  },
});
