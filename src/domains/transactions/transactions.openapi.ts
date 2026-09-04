import { z } from "zod";
import { errorResponse, registry } from "@/adapters/swagger/registry.js";
import { createTransactionSchema, updateTransactionSchema } from "@/domains/transactions/transactions.routes.js";

const transactionSchema = z
  .object({
    id: z.string(),
    symbol: z.string(),
    action: z.enum(["BUY", "SELL"]),
    quantity: z.number(),
    price: z.string(),
    fee: z.string(),
    tax: z.string(),
    tradeDate: z.string(),
    note: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("StockTransaction");

const idParam = z.object({ id: z.string().openapi({ format: "uuid" }) });
const unauthorized = errorResponse("缺少或無效的 Authorization header / token。");
const notFound = errorResponse("此 id 不存在，或不屬於目前登入的使用者。");

registry.registerPath({
  method: "get",
  path: "/transactions",
  summary: "列出目前登入使用者的交易日誌（買進／賣出紀錄）",
  tags: ["Transactions"],
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({ symbol: z.string().optional().openapi({ description: "只列出這個股票代號的交易紀錄。" }) }),
  },
  responses: {
    200: {
      description: "交易紀錄清單（依交易日期新到舊排序）。",
      content: { "application/json": { schema: z.object({ transactions: z.array(transactionSchema) }) } },
    },
    401: unauthorized,
  },
});

registry.registerPath({
  method: "post",
  path: "/transactions",
  summary: "新增一筆交易日誌（買進／賣出紀錄）",
  description: "這是獨立的交易日誌，不會自動更新 /holdings 的持股數量；會先確認 symbol 在 twse/tpex 其中一邊查得到資料。",
  tags: ["Transactions"],
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createTransactionSchema.openapi("CreateTransactionRequest") } },
    },
  },
  responses: {
    201: {
      description: "新增成功的交易紀錄。",
      content: { "application/json": { schema: z.object({ transaction: transactionSchema }) } },
    },
    400: errorResponse("缺少必填欄位，或欄位型別/數值不合法。"),
    401: unauthorized,
    404: errorResponse("此股票代號在 twse/tpex 都查無資料。"),
  },
});

registry.registerPath({
  method: "get",
  path: "/transactions/{id}",
  summary: "查詢單一交易紀錄",
  tags: ["Transactions"],
  security: [{ bearerAuth: [] }],
  request: { params: idParam },
  responses: {
    200: {
      description: "交易紀錄。",
      content: { "application/json": { schema: z.object({ transaction: transactionSchema }) } },
    },
    400: errorResponse("id 不是合法的 UUID。"),
    401: unauthorized,
    404: notFound,
  },
});

registry.registerPath({
  method: "patch",
  path: "/transactions/{id}",
  summary: "更新一筆交易紀錄",
  description: "symbol 不可變更（要換 symbol 請刪除後重新新增）。",
  tags: ["Transactions"],
  security: [{ bearerAuth: [] }],
  request: {
    params: idParam,
    body: { content: { "application/json": { schema: updateTransactionSchema.openapi("UpdateTransactionRequest") } } },
  },
  responses: {
    200: {
      description: "更新後的交易紀錄。",
      content: { "application/json": { schema: z.object({ transaction: transactionSchema }) } },
    },
    400: errorResponse("id 不是合法的 UUID，或欄位型別/數值不合法。"),
    401: unauthorized,
    404: notFound,
  },
});

registry.registerPath({
  method: "delete",
  path: "/transactions/{id}",
  summary: "刪除一筆交易紀錄",
  tags: ["Transactions"],
  security: [{ bearerAuth: [] }],
  request: { params: idParam },
  responses: {
    204: { description: "刪除成功，無回應內容。" },
    400: errorResponse("id 不是合法的 UUID。"),
    401: unauthorized,
    404: notFound,
  },
});
