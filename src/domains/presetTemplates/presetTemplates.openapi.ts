import { z } from "zod";
import { errorResponse, registry } from "@/adapters/swagger/registry.js";
import { presetSchema } from "@/domains/screener/screenerPresets.openapi.js";

const presetTemplateSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    category: z.string(),
    description: z.string(),
    tier: z.enum(["FREE", "PAID"]),
    status: z.enum(["AVAILABLE", "PENDING"]),
    pendingReason: z.string().nullable(),
    filters: z.array(z.object({ field: z.string(), min: z.number().nullable(), max: z.number().nullable(), exclude: z.boolean() })),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("PresetTemplate");

const idParam = z.object({ id: z.string().openapi({ format: "uuid" }) });

registry.registerPath({
  method: "get",
  path: "/screener/templates",
  summary: "列出所有人共用的篩選策略範本（大師策略／量化因子／台股籌碼面等）",
  description:
    "不需要登入即可查看。每筆都有 tier（FREE/PAID，前端自行決定顯示/鎖定方式，這個服務本身不做付費驗證）跟 status（AVAILABLE 可直接套用；PENDING 表示目前生態系還沒有計算這個範本需要的指標，pendingReason 說明缺什麼，filters 會是空陣列）。",
  tags: ["Screener"],
  responses: {
    200: {
      description: "範本清單，依建議瀏覽順序排序。",
      content: { "application/json": { schema: z.object({ templates: z.array(presetTemplateSchema) }) } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/screener/templates/{id}",
  summary: "查詢單一範本的完整內容",
  tags: ["Screener"],
  request: { params: idParam },
  responses: {
    200: { description: "範本內容。", content: { "application/json": { schema: z.object({ template: presetTemplateSchema }) } } },
    400: errorResponse("id 不是合法的 UUID。"),
    404: errorResponse("找不到這個範本。"),
  },
});

registry.registerPath({
  method: "post",
  path: "/screener/templates/{id}/apply",
  summary: "把範本複製成一份自己的篩選組合（ScreenerPreset）",
  description:
    "需要登入。新建立的 preset 會以範本名稱命名（撞名依序改成「範本名稱 2」「範本名稱 3」...）；之後編輯/刪除都跟一般 preset 一樣，不會再跟原範本有關聯。status 是 PENDING 的範本沒有真正的 filters 可以複製，套用會回 409。",
  tags: ["Screener"],
  security: [{ bearerAuth: [] }],
  request: { params: idParam },
  responses: {
    201: {
      description: "新建立的篩選組合（跟 POST /screener/presets 回應格式相同）。",
      content: { "application/json": { schema: z.object({ preset: presetSchema }) } },
    },
    400: errorResponse("id 不是合法的 UUID。"),
    401: errorResponse("缺少或無效的 Authorization header / token。"),
    404: errorResponse("找不到這個範本。"),
    409: errorResponse("這個範本目前是 PENDING（還沒有真正可執行的 filters），無法套用。"),
  },
});
