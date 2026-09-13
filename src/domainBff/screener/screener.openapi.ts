import { z } from "zod";
import { errorResponse, registry } from "@/adapters/swagger/registry.js";
import { rankingQuerySchema, screenerRequestSchema, screenerValuesRequestSchema } from "@/domainBff/screener/screener.routes.js";

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
    "不需要登入即可使用（僅儲存為具名 preset 才需要，見 POST /screener/presets）。field 格式為 \"<metricCode>.<token>\"（例如 \"grossMargin.TTM\"、\"beta.2Y_1W\"），對應 GET /metrics 每個 metricCode 底下的 validTokens 陣列——務必用 validTokens，部分指標（例如 beta）的可用 token 不是任意組合，只有特定值才有資料。metricName 從 2026-09-09 起是 analysis-ts 提供的真實中文名稱（例如「殖利率（交易所公告）」），fieldName 目前仍是 token 本身（analysis-ts 還沒有針對個別 token 的文案）。每個指標會取該股票最新一筆合併報表（非子公司）的數值來比對，不同指標之間用 AND 合併。sectorCodes 是選填的證交所類股代碼陣列（見 GET /industries/securities-sectors），多個代碼是聯集（OR），再跟 filters 的結果 AND；這裡的 sectorCodes 只影響這次查詢本身，若要讓某組已儲存的篩選組合記住類股條件，請用 POST/PATCH /screener/presets 上同名的欄位。顯示欄位由 columnPresetId 或 columns 其中一個決定，兩者互斥（都給會 400）：columnPresetId 是已登入使用者自己的 ColumnPreset id（見 GET /screener/column-presets）——未登入請求帶 columnPresetId 會被忽略，一律當作沒給；columns 是原始欄位 key 陣列（跟 field 格式一樣，例如 ColumnPresetTemplate 的 fieldKeys，見 GET /screener/column-preset-templates），不需要登入、不需要先建立任何個人資源，這是訪客／一次性查詢唯一能指定顯示欄位的方式。兩者都沒給的話：已登入就用該帳號自己設的預設欄位組合，找不到就用系統內建的常用欄位；未登入一律套用系統內建欄位。回應的 columnPresetId 會標明實際套用的是哪一組（null 代表用的是系統內建，或這次是用 columns 直接指定）。每個 results[].values 底下的欄位都是 { value, knowledgeDate, nullReason } 物件，不是純值。knowledgeDate 統一是實際日期字串（\"YYYY-MM-DD\"，knowledge date，2026-09-13 起由 asOfDate 更名，語意是「這個值哪天被市場公告知道」）；value 為 null 時 nullReason 會是 missing_input/zero_or_negative_denominator/not_applicable_industry/insufficient_history 四選一（跟 metric-history 系列端點同一套），value 有值或來源沒有分類原因時 nullReason 為 null（例如 stock.price 特殊欄位）。",
  tags: ["Screener"],
  security: [{ bearerAuth: [] }, {}],
  request: { body: { required: true, content: { "application/json": { schema: screenerRequestDocSchema } } } },
  responses: {
    200: {
      description: "符合條件的股票清單（這一頁的部分），附上總筆數/頁碼/總頁數，以及實際套用的 columnPresetId。",
      content: { "application/json": { schema: screenerResultSchema } },
    },
    400: errorResponse("請求格式錯誤，field 不存在於 filterCatalog，page/pageSize 不合法，或 columnPresetId 和 columns 同時給了。"),
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
    "不需要登入。只依 field 這一個指標排序，沒有門檻條件，direction=asc 由小到大、direction=desc（預設）由大到小。排行欄位本身一定會被排除 null（沒有這個數字的公司不會出現），也一定會出現在回傳的 columns/values 裡；columns 可以額外加逗號分隔的顯示欄位（含 \"stock.price\"）。sectorCodes 是選填的逗號分隔證交所類股代碼（見 GET /industries/securities-sectors），多個代碼是聯集（OR）——但僅限一般排行路徑：exchangePeRatio.EOD／exchangePbRatio.EOD／dividendYield.EOD 這三個特例欄位是走 analysis-ts 另一支估值排行端點，沒有類股篩選能力，帶了 sectorCodes 會回 400。results[].values 底下每個欄位都是 { value, knowledgeDate, nullReason } 物件，shape 跟 POST /screener 一致。",
  tags: ["Screener"],
  request: { query: rankingQueryDocSchema },
  responses: {
    200: {
      description: "排行結果（不分頁，就是前 limit 名）。knowledgeDate 統一是實際日期字串（\"YYYY-MM-DD\"，knowledge date）。",
      content: { "application/json": { schema: rankingResultSchema } },
    },
    400: errorResponse("缺少 field，field 不存在於 filterCatalog，或 direction/limit/columns 格式錯誤。"),
    502: upstream502,
  },
});
