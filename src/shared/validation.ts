import { z, type ZodType } from "zod";
import { AppError } from "@/domain/appError.js";

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

/**
 * A query-string boolean: accepts only the literal `"true"` / `"false"`, and treats an absent or empty
 * value as "not given" (`undefined`) rather than as false, so a route can tell "explicitly false" from
 * "didn't say".
 *
 * This exists to make the correct spelling the *shortest* one. The obvious alternative,
 * `z.coerce.boolean()`, is a trap: it is `Boolean(value)` underneath, so every non-empty query string —
 * including the literal `"false"` and `"0"` — becomes `true`. analysis-ts shipped exactly that bug on
 * `excludeZero`, and it was invisible for weeks because the resulting numbers look perfectly reasonable;
 * they simply answer a different question. They had already hit it twice elsewhere and left warning
 * comments in those modules, which did not stop the third occurrence — nobody writing a new module reads
 * another module's comments. A comment cannot compete with a shorter wrong answer; a helper can.
 */
export function booleanQueryParam(name: string) {
  return z.preprocess(
    (v) => (v === undefined || v === "" ? undefined : v),
    z
      .enum(["true", "false"], { error: `"${name}" must be "true" or "false"` })
      .transform((v) => v === "true")
      .optional(),
  );
}
