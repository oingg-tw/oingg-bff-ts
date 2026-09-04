import { z } from "zod";
import { errorResponse, registry } from "@/adapters/swagger/registry.js";

const upstream502 = errorResponse("analysis-ts 服務無法連線或回應格式異常。");

const screenerFilterSchema = z.object({
  field: z.string().openapi({ example: "grossMargin.grossMarginTtm" }),
  min: z.number().nullish(),
  max: z.number().nullish(),
  exclude: z.boolean().optional().openapi({ default: false, description: "false（預設）＝保留 min~max 範圍內的股票；true＝反過來，保留範圍外的股票" }),
});

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

const screenerRequestSchema = z
  .object({
    filters: z.array(screenerFilterSchema).min(1),
    columnPresetId: z.string().nullish().openapi({ format: "uuid", description: "要用哪組顯示欄位（見說明），省略則自動選一組。" }),
    page: z.number().int().optional().openapi({ default: 1, description: "頁碼（從 1 開始）。" }),
    pageSize: z.number().int().optional().openapi({ default: 50, description: "每頁筆數，最多 200。" }),
    sortField: z.string().optional().openapi({
      description: "要嘛跟 sortOrder 一起給，要嘛都不給；只給一個會 400。省略則不保證特定順序。排序是對整個符合條件的結果集排序（分頁之前），不是只排這一頁。",
    }),
    sortOrder: z.enum(["asc", "desc"]).optional(),
  })
  .openapi("ScreenerRequest");

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
      columns: [{ field: "per.peRatio", metricName: "本益比 PER", fieldName: "本益比 PER", unit: "times" }],
      results: [{ symbol: "2330", values: { "per.peRatio": { value: "27.82", asOfDate: "2026-08-16" } } }],
    },
  });

registry.registerPath({
  method: "post",
  path: "/screener",
  summary: "依 filterCatalog 指標篩選個股",
  description:
    "不需要登入即可使用（僅儲存為具名 preset 才需要，見 POST /screener/presets）。field 格式為 \"<metricKey>.<fieldKey>\"（例如 \"grossMargin.grossMarginTtm\"），對應 GET /filters 回傳的分類/指標/欄位目錄。每個指標會取該股票最新一筆合併報表（非子公司）的數值來比對，不同指標之間用 AND 合併。顯示欄位由 columnPresetId 決定：有給就用那組（見 GET /screener/column-presets，僅限已登入）；沒給、但帶有效 Authorization header，就用該帳號自己設的預設欄位組合，找不到就用系統內建的常用欄位；未登入一律套用系統內建欄位。回應的 columnPresetId 會標明實際套用的是哪一組（null 代表用的是系統內建）。每個 results[].values 底下的欄位都是 { value, asOfDate } 物件，不是純值。季報類指標的 asOfDate 是 \"{兩位數年}Q{季別}\"（例如 \"26Q2\"）；日頻／技術指標則是實際日期（\"YYYY-MM-DD\"）。",
  tags: ["Screener"],
  security: [{ bearerAuth: [] }, {}],
  request: { body: { required: true, content: { "application/json": { schema: screenerRequestSchema } } } },
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

const screenerValuesRequestSchema = z
  .object({
    symbols: z.array(z.string()).min(1).openapi({ example: ["2330", "2317"] }),
    columns: z.array(z.object({ field: z.string().openapi({ example: "roe.roeTtmPct" }) })).min(1),
  })
  .openapi("ScreenerValuesRequest");

const screenerValuesResultSchema = z
  .object({
    count: z.number(),
    columns: z.array(screenerColumnSchema),
    results: z.array(screenerResultRowSchema),
  })
  .openapi("ScreenerValuesResult", {
    example: {
      count: 2,
      columns: [{ field: "roe.roeTtmPct", metricName: "股東權益報酬率 ROE", fieldName: "ROE", unit: "percent" }],
      results: [
        { symbol: "2330", name: "台積電", values: { "roe.roeTtmPct": { value: "34.78", asOfDate: "26Q2" } } },
        { symbol: "2317", name: "鴻海", values: { "roe.roeTtmPct": { value: "12.34", asOfDate: "26Q2" } } },
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
  request: { body: { required: true, content: { "application/json": { schema: screenerValuesRequestSchema } } } },
  responses: {
    200: { description: "每個 symbols 裡的代號都會有一列結果。", content: { "application/json": { schema: screenerValuesResultSchema } } },
    400: errorResponse("symbols/columns 格式錯誤、其中一個 field 不存在於 filterCatalog，或 symbols 超過 200 個。"),
    502: upstream502,
  },
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
      field: "roe.roeTtmPct",
      direction: "desc",
      columns: [{ field: "roe.roeTtmPct", metricName: "股東權益報酬率 ROE", fieldName: "ROE", unit: "percent" }],
      results: [{ symbol: "2330", values: { "roe.roeTtmPct": { value: "34.78", asOfDate: "26Q2" } } }],
    },
  });

registry.registerPath({
  method: "get",
  path: "/screener/ranking",
  summary: "依單一指標排行（例如殖利率最高、本益比最低）——給首頁卡片用，不是完整篩選",
  description:
    "不需要登入。只依 field 這一個指標排序，沒有門檻條件，direction=asc 由小到大、direction=desc（預設）由大到小。排行欄位本身一定會被排除 null（沒有這個數字的公司不會出現），也一定會出現在回傳的 columns/values 裡；columns 可以額外加逗號分隔的顯示欄位（含 \"stock.price\"）。results[].values 底下每個欄位都是 { value, asOfDate } 物件，shape 跟 POST /screener 一致。",
  tags: ["Screener"],
  request: {
    query: z.object({
      field: z.string().openapi({ example: "dividendYield.dividendYieldPct" }),
      direction: z.enum(["asc", "desc"]).optional().openapi({ default: "desc" }),
      limit: z.coerce.number().int().optional().openapi({ default: 10, description: "最多 50。" }),
      columns: z.string().optional().openapi({ description: "逗號分隔的額外顯示欄位，例如 \"stock.price\"。" }),
    }),
  },
  responses: {
    200: {
      description: "排行結果（不分頁，就是前 limit 名）。asOfDate 對季報類指標是 \"{兩位數年}Q{季別}\" 格式，對日頻／技術指標則是實際日期。",
      content: { "application/json": { schema: rankingResultSchema } },
    },
    400: errorResponse("缺少 field，field 不存在於 filterCatalog，或 direction/limit/columns 格式錯誤。"),
    502: upstream502,
  },
});
