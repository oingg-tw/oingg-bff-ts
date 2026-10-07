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
    type: z.string().openapi({ example: "about:blank", description: "問題類別。沒有 code 的錯誤是 \"about:blank\"（RFC 9457 §4.2.1：語意不超出 HTTP 狀態碼）；有 code 的是由 code 推出的 tag URI，例如 `tag:oingg.com,2026:quota-exceeded`（無法解析，§3.1.1 允許）。type 與 code 一一對應，分支用哪個都可以。" }),
    title: z.string().openapi({ example: "Bad Request", description: "HTTP 狀態碼的標準短語，同一個 status 永遠相同。" }),
    status: z.number().openapi({ example: 400, description: "等於 HTTP 回應的狀態碼。" }),
    detail: z.string().openapi({ description: "給人看的說明。措辭不保證穩定，**不要拿 regex 解析**，結構化資料在擴充成員裡。" }),
    instance: z.string().openapi({ example: "urn:uuid:f47ac10b-58cc-4372-a567-0e02b2c3d479", description: "這次請求的 ID，跟 X-Request-Id header 同值；回報問題時引用它。" }),
    code: z.string().optional().openapi({ description: "穩定的機器可讀原因，只有呼叫端需要分支時才帶：quota_exceeded（403）、LEDGER_OVERSOLD（400）、LEDGER_SHORTFALL（422）、REORDER_MISMATCH（400，三支 reorder）、RANGE_BEFORE_PRICE_HISTORY（400，帶 earliestPriceDate）、RATE_LIMITED（429）、UPSTREAM_TIMEOUT（504）、UPSTREAM_UNAVAILABLE（502）。" }),
    errors: z
      .array(z.object({ detail: z.string(), pointer: z.string().optional(), parameter: z.string().optional() }))
      .optional()
      .openapi({ description: "參數驗證失敗（400）時才有，RFC 9457 §3 的形狀。body 欄位用 `pointer`（URI fragment 形式的 JSON Pointer，例如 `#/transactions/0/price`）；query 參數用 `parameter`（例如 `lookbackYears`）。" }),
  })
  .passthrough()
  .openapi("Problem");

export function errorResponse(description: string) {
  return {
    description,
    content: { "application/problem+json": { schema: errorResponseSchema } },
  };
}
