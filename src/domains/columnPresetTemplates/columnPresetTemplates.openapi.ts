import { z } from "zod";
import { errorResponse, registry } from "@/adapters/swagger/registry.js";
import { columnPresetSchema } from "@/domains/screener/columnPresets.openapi.js";

const columnPresetTemplateSchema = z
  .object({
    key: z.string(),
    name: z.string(),
    description: z.string(),
    fieldKeys: z.array(z.string()),
    isDefault: z.boolean(),
  })
  .openapi("ColumnPresetTemplate");

const keyParam = z.object({ key: z.string() });

registry.registerPath({
  method: "get",
  path: "/screener/column-preset-templates",
  summary: "列出所有人共用的欄位組合範本（存股領息／價值投資／獲利品質拆解等）",
  description:
    "不需要登入即可查看。由 oingg-analysis-ts 統一維護內容，開機時同步進本服務自己的資料庫（跟 GET /filters 的 filter catalog 同步機制一樣）。其中恰好一組會標記 isDefault: true（目前是「總覽」），這組也是 POST /screener 在沒有指定/沒有使用者自訂預設欄位時的實際 fallback columns。",
  tags: ["Screener"],
  responses: {
    200: {
      description: "範本清單，依建議瀏覽順序排序。",
      content: { "application/json": { schema: z.object({ templates: z.array(columnPresetTemplateSchema) }) } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/screener/column-preset-templates/{key}",
  summary: "查詢單一欄位組合範本的完整內容",
  tags: ["Screener"],
  request: { params: keyParam },
  responses: {
    200: { description: "範本內容。", content: { "application/json": { schema: z.object({ template: columnPresetTemplateSchema }) } } },
    404: errorResponse("找不到這個範本。"),
  },
});

registry.registerPath({
  method: "post",
  path: "/screener/column-preset-templates/{key}/apply",
  summary: "把欄位組合範本複製成一份自己的欄位組合（ColumnPreset）",
  description: "需要登入。新建立的 preset 會以範本名稱命名（撞名依序改成「範本名稱 2」「範本名稱 3」...）；之後編輯/刪除都跟一般 column preset 一樣，不會再跟原範本有關聯。",
  tags: ["Screener"],
  security: [{ bearerAuth: [] }],
  request: { params: keyParam },
  responses: {
    201: {
      description: "新建立的欄位組合（跟 POST /screener/column-presets 回應格式相同）。",
      content: { "application/json": { schema: z.object({ preset: columnPresetSchema }) } },
    },
    401: errorResponse("缺少或無效的 Authorization header / token。"),
    404: errorResponse("找不到這個範本。"),
  },
});
