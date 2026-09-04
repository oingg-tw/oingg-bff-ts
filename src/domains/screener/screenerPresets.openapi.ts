import { z } from "zod";
import { errorResponse, registry } from "@/adapters/swagger/registry.js";
import {
  createScreenerPresetSchema,
  runPresetQuerySchema,
  updateScreenerPresetSchema,
} from "@/domains/screener/screenerPresets.routes.js";

const presetFilterViewSchema = z.object({
  field: z.string(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  exclude: z.boolean(),
});

export const presetSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    filters: z.array(presetFilterViewSchema),
    lastColumnPresetId: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("ScreenerPreset");

const idParam = z.object({ id: z.string().openapi({ format: "uuid" }) });
const unauthorized = errorResponse("缺少或無效的 Authorization header / token。");
const notFound = errorResponse("不存在，或不屬於目前登入的使用者。");

const createScreenerPresetDocSchema = createScreenerPresetSchema.openapi("CreateScreenerPresetRequest", {
  example: { filters: [{ field: "roe.roeTtmPct", min: 30, max: null, exclude: false }] },
});
const updateScreenerPresetDocSchema = updateScreenerPresetSchema.openapi("UpdateScreenerPresetRequest");

registry.registerPath({
  method: "get",
  path: "/screener/presets",
  summary: "列出目前使用者儲存的篩選組合",
  tags: ["Screener"],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "篩選組合清單（含每組的完整 filters），依建立時間新到舊排序。",
      content: { "application/json": { schema: z.object({ presets: z.array(presetSchema) }) } },
    },
    401: unauthorized,
  },
});

registry.registerPath({
  method: "post",
  path: "/screener/presets",
  summary: "儲存一組新的篩選組合",
  description:
    "沒有 name 參數——新建立的組合一律取名「未命名」（撞名的話依序改成「未命名 2」「未命名 3」...，跟電腦新增檔案一樣不會報錯），前端請之後再用 PATCH /screener/presets/{id} 改名。格式跟 POST /screener 完全一樣，filters 可以是空陣列——此時會預設套用 ROE > 30（roe.roeTtmPct），之後可再用 PATCH 覆蓋條件。",
  tags: ["Screener"],
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createScreenerPresetDocSchema } },
    },
  },
  responses: {
    201: {
      description: "新增成功的篩選組合（name 固定是「未命名」或其變體）。",
      content: { "application/json": { schema: z.object({ preset: presetSchema }) } },
    },
    400: errorResponse("缺少 filters，或有 field 不存在於 filterCatalog。"),
    401: unauthorized,
  },
});

registry.registerPath({
  method: "get",
  path: "/screener/presets/{id}",
  summary: "查詢單一篩選組合的設定內容",
  tags: ["Screener"],
  security: [{ bearerAuth: [] }],
  request: { params: idParam },
  responses: {
    200: { description: "篩選組合的名稱與 filters。", content: { "application/json": { schema: z.object({ preset: presetSchema }) } } },
    401: unauthorized,
    404: notFound,
  },
});

registry.registerPath({
  method: "patch",
  path: "/screener/presets/{id}",
  summary: "更新篩選組合的名稱和／或條件",
  description: "filters 有給的話是整組覆蓋（不是增量），跟 PATCH /screener/column-presets/{id} 的 columns 同樣邏輯。",
  tags: ["Screener"],
  security: [{ bearerAuth: [] }],
  request: {
    params: idParam,
    body: { content: { "application/json": { schema: updateScreenerPresetDocSchema } } },
  },
  responses: {
    200: { description: "更新後的篩選組合。", content: { "application/json": { schema: z.object({ preset: presetSchema }) } } },
    400: errorResponse("有 field 不存在於 filterCatalog。"),
    401: unauthorized,
    404: notFound,
    409: errorResponse("已經有同名的篩選組合。"),
  },
});

registry.registerPath({
  method: "delete",
  path: "/screener/presets/{id}",
  summary: "刪除一組篩選組合",
  tags: ["Screener"],
  security: [{ bearerAuth: [] }],
  request: { params: idParam },
  responses: {
    204: { description: "刪除成功，無回應內容。" },
    401: unauthorized,
    404: notFound,
  },
});

const screenerValueSchema = z.object({ value: z.unknown().nullable(), asOfDate: z.string().nullable() });
const runPresetResultSchema = z
  .object({
    preset: presetSchema,
    count: z.number(),
    page: z.number(),
    pageSize: z.number(),
    totalPages: z.number(),
    columnPresetId: z.string().nullable(),
    columns: z.array(z.object({ field: z.string(), metricName: z.string(), fieldName: z.string(), unit: z.string().nullable().optional() })),
    results: z.array(z.object({ symbol: z.string(), name: z.string().nullable().optional(), values: z.record(z.string(), screenerValueSchema) })),
  })
  .openapi("RunScreenerPresetResult");

registry.registerPath({
  method: "get",
  path: "/screener/presets/{id}/run",
  summary: "用已儲存的篩選組合查詢股票——只要帶 id",
  description:
    "一次回傳這組篩選條件本身（preset）跟符合條件的股票（screener），前端不用另外組 filters。顯示欄位解析順序：query 給的 columnPresetId（有給的話，也會記成這組 preset「下次預設顯示」的欄位組合）→ 這組 preset 上次檢視用的欄位組合 → 使用者自己的預設欄位組合 → 系統內建常用欄位。回應的 columnPresetId 標明實際套用的是哪一組（null 代表系統內建）。",
  tags: ["Screener"],
  security: [{ bearerAuth: [] }],
  request: {
    params: idParam,
    query: runPresetQuerySchema.openapi("RunScreenerPresetQuery", {
      example: { page: 1, pageSize: 50 },
    }),
  },
  responses: {
    200: {
      description: "preset（名稱與條件）+ screener 結果（count/page/pageSize/totalPages/columns/results）+ 實際套用的 columnPresetId。",
      content: { "application/json": { schema: runPresetResultSchema } },
    },
    400: errorResponse("columnPresetId 不是合法的 UUID，page/pageSize 不是合法的正整數，或 sortField/sortOrder 格式錯誤。"),
    401: unauthorized,
    404: errorResponse("preset 不存在／不屬於使用者，或指定的 columnPresetId 不存在／不屬於使用者。"),
  },
});
