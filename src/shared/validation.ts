import type { ZodType } from "zod";
import { AppError } from "@/shared/errorHandler.js";

/**
 * Validates `body` against `schema`, throwing a 400 AppError (bff-ts's own `{ error: { message } }`
 * envelope) with a field-level message on failure instead of letting a malformed request reach the
 * service layer as ad hoc `as { field?: unknown }` casts + scattered manual checks.
 */
export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "(body)"}: ${issue.message}`)
      .join("; ");
    throw new AppError(message, 400);
  }
  return result.data;
}
