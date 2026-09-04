import { z } from "zod";
import { errorResponse, registry } from "@/adapters/swagger/registry.js";
import { addWatchlistItemSchema, updateWatchlistItemSchema } from "@/domains/watchlist/watchlist.routes.js";

const watchlistItemSchema = z
  .object({
    id: z.string(),
    symbol: z.string(),
    note: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("WatchlistItem");

const idParam = z.object({ id: z.string().openapi({ format: "uuid" }) });
const unauthorized = errorResponse("缺少或無效的 Authorization header / token。");
const notFound = errorResponse("此 id 不存在，或不屬於目前登入的使用者。");

registry.registerPath({
  method: "get",
  path: "/watchlist",
  summary: "列出目前登入使用者的自選股清單",
  tags: ["Watchlist"],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "自選股清單（依加入時間新到舊排序）。",
      content: { "application/json": { schema: z.object({ items: z.array(watchlistItemSchema) }) } },
    },
    401: unauthorized,
  },
});

registry.registerPath({
  method: "post",
  path: "/watchlist",
  summary: "加入一檔股票到自選股清單",
  description: "會先確認 symbol 在 twse/tpex 其中一邊查得到資料，查不到回 404；同一使用者重複加入同一 symbol 回 409。",
  tags: ["Watchlist"],
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: addWatchlistItemSchema.openapi("AddWatchlistItemRequest") } },
    },
  },
  responses: {
    201: {
      description: "新增成功的自選股項目。",
      content: { "application/json": { schema: z.object({ item: watchlistItemSchema }) } },
    },
    400: errorResponse("缺少 symbol，或 note 型別不是字串。"),
    401: unauthorized,
    404: errorResponse("此股票代號在 twse/tpex 都查無資料。"),
    409: errorResponse("這個 symbol 已經在自選股清單裡。"),
  },
});

registry.registerPath({
  method: "get",
  path: "/watchlist/{id}",
  summary: "查詢自選股清單中的單一項目",
  tags: ["Watchlist"],
  security: [{ bearerAuth: [] }],
  request: { params: idParam },
  responses: {
    200: { description: "自選股項目。", content: { "application/json": { schema: z.object({ item: watchlistItemSchema }) } } },
    400: errorResponse("id 不是合法的 UUID。"),
    401: unauthorized,
    404: notFound,
  },
});

registry.registerPath({
  method: "patch",
  path: "/watchlist/{id}",
  summary: "更新自選股項目的筆記",
  description: "目前只能改 note，symbol 不可變更（要換 symbol 請刪除後重新加入）。",
  tags: ["Watchlist"],
  security: [{ bearerAuth: [] }],
  request: {
    params: idParam,
    body: { content: { "application/json": { schema: updateWatchlistItemSchema.openapi("UpdateWatchlistItemRequest") } } },
  },
  responses: {
    200: {
      description: "更新後的自選股項目。",
      content: { "application/json": { schema: z.object({ item: watchlistItemSchema }) } },
    },
    400: errorResponse("id 不是合法的 UUID，或 note 型別不是字串。"),
    401: unauthorized,
    404: notFound,
  },
});

registry.registerPath({
  method: "delete",
  path: "/watchlist/{id}",
  summary: "從自選股清單移除一個項目",
  tags: ["Watchlist"],
  security: [{ bearerAuth: [] }],
  request: { params: idParam },
  responses: {
    204: { description: "刪除成功，無回應內容。" },
    400: errorResponse("id 不是合法的 UUID。"),
    401: unauthorized,
    404: notFound,
  },
});
