import { z } from "zod";
import { registry } from "@/http/swagger/registry.js";

const dependencyStatusSchema = z.object({
  status: z.enum(["ok", "error"]),
  latencyMs: z.number().optional(),
  error: z.string().optional(),
});

const healthReportSchema = z
  .object({
    status: z.enum(["ok", "degraded"]),
    uptimeSeconds: z.number(),
    startedAt: z.string(),
    dependencies: z.object({
      appDb: dependencyStatusSchema,
      analysisService: dependencyStatusSchema.openapi({ description: "analysis-ts 的存活檢查（打它的 `GET /`，不碰它的資料庫），2026-10-08 加。" }),
    }),
  })
  .openapi("HealthReport");

registry.registerPath({
  method: "get",
  path: "/system/health",
  summary: "健康檢查——實際敲 app DB 與 analysis-ts，不是只回報 process 有沒有活著",
  description:
    "對這個服務自己的 app DB 發一次 `SELECT 1`、對 analysis-ts 打一次存活檢查（各 3 秒逾時），回報兩者的狀態與延遲。任何一個失敗，整體 status 就是 \"degraded\" 且 HTTP 503；全部正常是 \"ok\" / 200。" +
    "**報告快取 5 秒**（2026-10-08，web-nuxt 的讀取失敗對話框會輪詢它），所以剛恢復的服務最多晚 5 秒才反映。" +
    "analysis-ts 那一項只代表它的程序有回應，不保證它的資料庫醒著。2026-10-08 以前回應裡還有一個永遠是 `{}` 的 `neon`，已移除。",
  tags: ["System"],
  responses: {
    200: {
      description: "全部相依服務都正常。",
      content: { "application/json": { schema: healthReportSchema } },
    },
    503: {
      description: "app DB 或 analysis-ts 至少一個沒回應。",
      content: { "application/json": { schema: healthReportSchema } },
    },
  },
});
