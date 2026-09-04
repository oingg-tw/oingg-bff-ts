import "@/adapters/swagger/zodExtend.js";
import { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

export const registry = new OpenAPIRegistry();

registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  description: "Firebase ID token（requireAuth middleware 驗證用）",
});

/** Shared error envelope — every route's 4xx/5xx responses use this shape. */
export const errorResponseSchema = z
  .object({
    error: z.object({
      message: z.string(),
      details: z.unknown().optional(),
    }),
  })
  .openapi("ErrorResponse");

export function errorResponse(description: string) {
  return {
    description,
    content: { "application/json": { schema: errorResponseSchema } },
  };
}
