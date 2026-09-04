import { z } from "zod";
import { errorResponse, registry } from "@/adapters/swagger/registry.js";

export const columnPresetSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    isDefault: z.boolean(),
    columns: z.array(z.object({ field: z.string(), metricName: z.string(), fieldName: z.string() })),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("ColumnPreset");

const idParam = z.object({ id: z.string().openapi({ format: "uuid" }) });
const unauthorized = errorResponse("缺少或無效的 Authorization header / token。");
const notFound = errorResponse("不存在，或不屬於目前登入的使用者。");

const createColumnPresetSchema = z
  .object({
    name: z.string().openapi({ example: "常用欄位" }),
    isDefault: z.boolean().optional().openapi({ default: false }),
    columns: z.array(z.object({ field: z.string().openapi({ example: "per.peRatio" }) })),
  })
  .openapi("CreateColumnPresetRequest");

const updateColumnPresetSchema = z
  .object({
    name: z.string().optional(),
    isDefault: z.boolean().optional(),
    columns: z.array(z.object({ field: z.string() })).optional(),
  })
  .openapi("UpdateColumnPresetRequest");

registry.registerPath({
  method: "get",
  path: "/screener/column-presets",
  summary: "列出目前使用者儲存的顯示欄位組合",
  tags: ["Screener"],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "欄位組合清單，依建立時間新到舊排序。",
      content: { "application/json": { schema: z.object({ columnPresets: z.array(columnPresetSchema) }) } },
    },
    401: unauthorized,
  },
});

registry.registerPath({
  method: "post",
  path: "/screener/column-presets",
  summary: "儲存一組新的顯示欄位組合",
  description:
    "field 格式跟 filters 一樣是 \"<metricKey>.<fieldKey>\"，另外多支援一個特殊欄位 \"stock.price\"（股價，來自 twse/tpex，不是 filterCatalog 的一部分）。isDefault=true 時會自動取消同一使用者底下其他組合的預設狀態——同時間最多只有一組是預設。columns 可以是空陣列。",
  tags: ["Screener"],
  security: [{ bearerAuth: [] }],
  request: { body: { required: true, content: { "application/json": { schema: createColumnPresetSchema } } } },
  responses: {
    201: { description: "新增成功的欄位組合。", content: { "application/json": { schema: z.object({ columnPreset: columnPresetSchema }) } } },
    400: errorResponse("缺少 name/columns，或有 field 既不是 filterCatalog 欄位也不是特殊欄位。"),
    401: unauthorized,
    409: errorResponse("已經有同名的欄位組合。"),
  },
});

registry.registerPath({
  method: "get",
  path: "/screener/column-presets/{id}",
  summary: "查詢單一顯示欄位組合的設定內容",
  tags: ["Screener"],
  security: [{ bearerAuth: [] }],
  request: { params: idParam },
  responses: {
    200: { description: "欄位組合。", content: { "application/json": { schema: z.object({ columnPreset: columnPresetSchema }) } } },
    401: unauthorized,
    404: notFound,
  },
});

registry.registerPath({
  method: "patch",
  path: "/screener/column-presets/{id}",
  summary: "更新顯示欄位組合（名稱／欄位／是否為預設，皆選填）",
  description: "columns 有給的話是整組覆蓋，不是增量。",
  tags: ["Screener"],
  security: [{ bearerAuth: [] }],
  request: { params: idParam, body: { content: { "application/json": { schema: updateColumnPresetSchema } } } },
  responses: {
    200: { description: "更新後的欄位組合。", content: { "application/json": { schema: z.object({ columnPreset: columnPresetSchema }) } } },
    400: errorResponse("有 field 既不是 filterCatalog 欄位也不是特殊欄位。"),
    401: unauthorized,
    404: notFound,
    409: errorResponse("已經有同名的欄位組合。"),
  },
});

registry.registerPath({
  method: "delete",
  path: "/screener/column-presets/{id}",
  summary: "刪除一組顯示欄位組合",
  description: "如果某個 screener preset 最後檢視時用的是這組，會被自動清掉（改回 null），不影響那個 screener preset 本身。",
  tags: ["Screener"],
  security: [{ bearerAuth: [] }],
  request: { params: idParam },
  responses: {
    204: { description: "刪除成功，無回應內容。" },
    401: unauthorized,
    404: notFound,
  },
});
