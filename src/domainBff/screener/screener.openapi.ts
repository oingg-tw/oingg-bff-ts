import { z } from "zod";
import { errorResponse, registry } from "@/adapters/swagger/registry.js";
import { rankingQuerySchema, screenerRequestSchema, screenerValuesRequestSchema } from "@/domainBff/screener/screener.routes.js";

const upstream502 = errorResponse("analysis-ts 服務無法連線或回應格式異常。");

const screenerValueSchema = z.object({ value: z.unknown().nullable(), asOfDate: z.string().nullable() });

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
      columns: [{ field: "exchangePeRatio.DAILY", metricName: "exchangePeRatio", fieldName: "DAILY", unit: null }],
      results: [{ symbol: "2330", values: { "exchangePeRatio.DAILY": { value: "27.82", asOfDate: "2026-08-16" } } }],
    },
  });

registry.registerPath({
  method: "post",
  path: "/screener",
  summary: "依 filterCatalog 指標篩選個股",
  description:
    "不需要登入即可使用（僅儲存為具名 preset 才需要，見 POST /screener/presets）。field 格式為 \"<metricCode>.<basis>\"（例如 \"grossMargin.TTM\"，basis 是 Q/Q_ANN/TTM/DAILY 等計算基期，不是舊架構的 fieldKey），對應 GET /filters 回傳的分類/指標/允許基期目錄——2026-09-08 analysis-ts 把底層資料模型換成 pitMetrics 後，目錄裡目前還沒有中文名稱/單位/公式說明，metricName/fieldName 暫時就是 metricCode/basis 本身，等 analysis-ts 補上文案後才會是可讀的中文（不用等前端改版，介面契約沒變）。每個指標會取該股票最新一筆合併報表（非子公司）的數值來比對，不同指標之間用 AND 合併。顯示欄位由 columnPresetId 決定：有給就用那組（見 GET /screener/column-presets，僅限已登入）；沒給、但帶有效 Authorization header，就用該帳號自己設的預設欄位組合，找不到就用系統內建的常用欄位；未登入一律套用系統內建欄位。回應的 columnPresetId 會標明實際套用的是哪一組（null 代表用的是系統內建）。每個 results[].values 底下的欄位都是 { value, asOfDate } 物件，不是純值。asOfDate 統一是實際日期字串（\"YYYY-MM-DD\"，knowledge date）——2026-09-08 之前的季報類指標曾經是 \"{兩位數年}Q{季別}\" 格式（例如 \"26Q2\"），pitMetrics 重建後已經統一成日期格式，不要假設還有季別字串出現。",
  tags: ["Screener"],
  security: [{ bearerAuth: [] }, {}],
  request: { body: { required: true, content: { "application/json": { schema: screenerRequestDocSchema } } } },
  responses: {
    200: {
      description: "符合條件的股票清單（這一頁的部分），附上總筆數/頁碼/總頁數，以及實際套用的 columnPresetId。",
      content: { "application/json": { schema: screenerResultSchema } },
    },
    400: errorResponse("請求格式錯誤，field 不存在於 filterCatalog，或 page/pageSize 不合法。"),
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
        { symbol: "2330", name: "台積電", values: { "roe.TTM": { value: "34.78", asOfDate: "2026-08-11" } } },
        { symbol: "2317", name: "鴻海", values: { "roe.TTM": { value: "11.15", asOfDate: "2026-06-30" } } },
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
  example: { field: "dividendYield.DAILY", direction: "desc", limit: 10 },
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
      results: [{ symbol: "2330", values: { "roe.TTM": { value: "34.78", asOfDate: "2026-08-11" } } }],
    },
  });

registry.registerPath({
  method: "get",
  path: "/screener/ranking",
  summary: "依單一指標排行（例如殖利率最高、本益比最低）——給首頁卡片用，不是完整篩選",
  description:
    "不需要登入。只依 field 這一個指標排序，沒有門檻條件，direction=asc 由小到大、direction=desc（預設）由大到小。排行欄位本身一定會被排除 null（沒有這個數字的公司不會出現），也一定會出現在回傳的 columns/values 裡；columns 可以額外加逗號分隔的顯示欄位（含 \"stock.price\"）。results[].values 底下每個欄位都是 { value, asOfDate } 物件，shape 跟 POST /screener 一致。",
  tags: ["Screener"],
  request: { query: rankingQueryDocSchema },
  responses: {
    200: {
      description: "排行結果（不分頁，就是前 limit 名）。asOfDate 對季報類指標是 \"{兩位數年}Q{季別}\" 格式，對日頻／技術指標則是實際日期。",
      content: { "application/json": { schema: rankingResultSchema } },
    },
    400: errorResponse("缺少 field，field 不存在於 filterCatalog，或 direction/limit/columns 格式錯誤。"),
    502: upstream502,
  },
});
