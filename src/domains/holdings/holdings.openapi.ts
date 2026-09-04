import { z } from "zod";
import { errorResponse, registry } from "@/adapters/swagger/registry.js";
import { createHoldingSchema, updateHoldingSchema } from "@/domains/holdings/holdings.routes.js";

const holdingSchema = z
  .object({
    id: z.string(),
    symbol: z.string(),
    quantity: z.number(),
    averageCost: z.string(),
    note: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Holding");

const idParam = z.object({ id: z.string().openapi({ format: "uuid" }) });
const unauthorized = errorResponse("缺少或無效的 Authorization header / token。");
const notFound = errorResponse("此 id 不存在，或不屬於目前登入的使用者。");

registry.registerPath({
  method: "get",
  path: "/holdings",
  summary: "列出目前登入使用者的持股",
  tags: ["Holdings"],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "持股清單（依建立時間新到舊排序）。",
      content: { "application/json": { schema: z.object({ holdings: z.array(holdingSchema) }) } },
    },
    401: unauthorized,
  },
});

registry.registerPath({
  method: "post",
  path: "/holdings",
  summary: "新增一筆持股",
  description:
    "持股是獨立維護的資料，不會從交易日誌（買進／賣出紀錄）自動計算；同一使用者同一 symbol 只能有一筆持股（重複回 409，請改用編輯）。會先確認 symbol 在 twse/tpex 其中一邊查得到資料。",
  tags: ["Holdings"],
  security: [{ bearerAuth: [] }],
  request: {
    body: { required: true, content: { "application/json": { schema: createHoldingSchema.openapi("CreateHoldingRequest") } } },
  },
  responses: {
    201: { description: "新增成功的持股。", content: { "application/json": { schema: z.object({ holding: holdingSchema }) } } },
    400: errorResponse("缺少必填欄位，或欄位型別/數值不合法。"),
    401: unauthorized,
    404: errorResponse("此股票代號在 twse/tpex 都查無資料。"),
    409: errorResponse("這個 symbol 已經有持股紀錄了。"),
  },
});

registry.registerPath({
  method: "get",
  path: "/holdings/{id}",
  summary: "查詢單一持股",
  tags: ["Holdings"],
  security: [{ bearerAuth: [] }],
  request: { params: idParam },
  responses: {
    200: { description: "持股資料。", content: { "application/json": { schema: z.object({ holding: holdingSchema }) } } },
    400: errorResponse("id 不是合法的 UUID。"),
    401: unauthorized,
    404: notFound,
  },
});

registry.registerPath({
  method: "patch",
  path: "/holdings/{id}",
  summary: "更新持股（股數／平均成本／備註）",
  description: "symbol 不可變更（要換 symbol 請刪除後重新加入）。",
  tags: ["Holdings"],
  security: [{ bearerAuth: [] }],
  request: {
    params: idParam,
    body: { content: { "application/json": { schema: updateHoldingSchema.openapi("UpdateHoldingRequest") } } },
  },
  responses: {
    200: { description: "更新後的持股。", content: { "application/json": { schema: z.object({ holding: holdingSchema }) } } },
    400: errorResponse("id 不是合法的 UUID，或欄位型別/數值不合法。"),
    401: unauthorized,
    404: notFound,
  },
});

registry.registerPath({
  method: "delete",
  path: "/holdings/{id}",
  summary: "刪除一筆持股",
  tags: ["Holdings"],
  security: [{ bearerAuth: [] }],
  request: { params: idParam },
  responses: {
    204: { description: "刪除成功，無回應內容。" },
    400: errorResponse("id 不是合法的 UUID。"),
    401: unauthorized,
    404: notFound,
  },
});
