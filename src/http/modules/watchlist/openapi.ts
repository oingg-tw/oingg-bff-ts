import { z } from "zod";
import { errorResponse, registry } from "@/http/swagger/registry.js";
import { addWatchlistItemSchema, reorderWatchlistSchema, updateWatchlistItemSchema } from "@/http/modules/watchlist/route.js";

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
      description: "自選股清單，依使用者自訂的順序（POST /watchlist/reorder）。新加入的排最後。",
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
    400: errorResponse("缺少 symbol，或 note 不是字串、超過 200 字。"),
    401: unauthorized,
    404: errorResponse("此股票代號在 twse/tpex 都查無資料。"),
    409: errorResponse("這個 symbol 已經在自選股清單裡。"),
  },
});

registry.registerPath({
  method: "post",
  path: "/watchlist/reorder",
  summary: "拖曳排序：重新排列自選股清單的順序",
  description:
    "ids 必須是目前清單裡每一個項目的 id 各一次（依新順序排列）——不能只給部分、不能多、不能重複，否則 400 且不寫入任何一列。前端拿到 400 代表手上的清單過期了（例如另一個分頁剛加了一檔），請重新 GET 再排。",
  tags: ["Watchlist"],
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: reorderWatchlistSchema.openapi("ReorderWatchlistRequest", { example: { ids: ["b7f3a6b0-....", "1c2d3e4f-...."] } }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "重新排序後的完整自選股清單。",
      content: { "application/json": { schema: z.object({ items: z.array(watchlistItemSchema) }) } },
    },
    400: errorResponse("ids 不是目前清單的完整 id 集合（漏了、多了或重複），或含有不合法的 UUID。"),
    401: unauthorized,
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
    400: errorResponse("id 不是合法的 UUID，或 note 不是字串、超過 200 字。"),
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
