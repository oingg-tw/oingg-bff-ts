import "@/http/swagger/zodExtend.js";
import { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

export const registry = new OpenAPIRegistry();

registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  description: "Firebase ID token（requireAuth middleware 驗證用）",
});

/**
 * Every 4xx/5xx is an RFC 9457 problem object served as application/problem+json (2026-10-08). See
 * errorHandler.ts for how each member is filled.
 */
export const errorResponseSchema = z
  .object({
    type: z.string().openapi({ example: "about:blank", description: "目前一律是 \"about:blank\"（RFC 9457 §4.2.1：沒有專屬文件 URI 時的標準值）。不要依它分支，用 status 與 code。" }),
    title: z.string().openapi({ example: "Bad Request", description: "HTTP 狀態碼的標準短語，同一個 status 永遠相同。" }),
    status: z.number().openapi({ example: 400, description: "等於 HTTP 回應的狀態碼。" }),
    detail: z.string().openapi({ description: "給人看的說明。措辭不保證穩定，**不要拿 regex 解析**，結構化資料在擴充成員裡。" }),
    instance: z.string().openapi({ example: "urn:uuid:f47ac10b-58cc-4372-a567-0e02b2c3d479", description: "這次請求的 ID，跟 X-Request-Id header 同值；回報問題時引用它。" }),
    code: z.string().optional().openapi({ description: "穩定的機器可讀原因，只有呼叫端需要分支時才帶：quota_exceeded、LEDGER_OVERSOLD、RATE_LIMITED、UPSTREAM_TIMEOUT（504）、UPSTREAM_UNAVAILABLE（502）。" }),
    invalid_params: z
      .array(z.object({ name: z.string(), reason: z.string(), code: z.string() }))
      .optional()
      .openapi({ description: "參數驗證失敗（400）時才有。name 是 RFC 6901 JSON Pointer（例如 /lookbackYears、/transactions/0/price），code 是 zod 的 issue code。" }),
    error: z
      .object({ message: z.string(), code: z.string().optional(), details: z.unknown().optional() })
      .openapi({ description: "**過渡期保留的舊格式**，message 等於 detail、code 等於頂層 code。前端改讀頂層欄位後會移除。" }),
  })
  .passthrough()
  .openapi("Problem");

export function errorResponse(description: string) {
  return {
    description,
    content: { "application/problem+json": { schema: errorResponseSchema } },
  };
}
