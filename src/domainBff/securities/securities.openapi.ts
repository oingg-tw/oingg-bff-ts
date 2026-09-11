import { z } from "zod";
import { errorResponse, registry } from "@/adapters/swagger/registry.js";
import { securityListQuerySchema } from "@/domainBff/securities/securities.routes.js";

const securityListSchema = z
  .object({
    count: z.number(),
    limit: z.number(),
    offset: z.number(),
    entries: z.array(z.object({ symbol: z.string(), name: z.string() })),
  })
  .openapi("SecurityList");

registry.registerPath({
  method: "get",
  path: "/securities",
  summary: "統一搜尋索引：普通股＋TWSE 特別股＋全部 ETF（全站搜尋列用的資料來源）",
  description:
    "資料來自 oingg-analysis-ts 的 GET /securities（2026-09-11 新增，取代先前需要合併 GET /stocks + GET /stocks/preferred-stocks + POST /etf-screener 三個來源才能建搜尋索引的作法）。目前約 2716 檔，需要分頁：limit 1-1000（預設 200），offset 預設 0，offset 超過 count 時回傳空的 entries 陣列（不是錯誤）。前端要拿到全部索引需要自己依 count 迴圈呼叫多次，這支端點單純原樣轉發 analysis-ts 的分頁參數。**沒有普通股／特別股／ETF 的類型欄位**——analysis-ts 這支端點目前只回 symbol/companyName，沒有提供類型區分，如果需要依類型導頁（例如點擊搜尋結果要分別導去 /stock/{code}、/preferred-stocks/{code}、/etf-zone），目前無法只靠這支端點的回應判斷，需要另外處理或請 analysis-ts 之後加欄位。",
  tags: ["Securities"],
  request: { query: securityListQuerySchema.openapi("SecurityListQuery", { example: { limit: 200, offset: 0 } }) },
  responses: {
    200: {
      description: "搜尋索引清單，count 是全部檔數（不受這次 limit 影響），可用來判斷還要不要繼續分頁。",
      content: { "application/json": { schema: securityListSchema } },
    },
    400: errorResponse("limit 不是 1-1000 之間的整數，或 offset 不是非負整數。"),
    502: errorResponse("analysis-ts 服務無法連線或回應格式異常。"),
  },
});
