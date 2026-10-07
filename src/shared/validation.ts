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
    // RFC 9457 的 invalid_params（2026-10-08）：name 是 RFC 6901 JSON Pointer，code 是 zod 的 issue code
    // （invalid_type、too_big…），前端靠 name／code 分支，不必拿 regex 去拆上面那句 detail。
    const invalidParams = result.error.issues.map((issue) => ({
      name: issue.path.map((part) => `/${String(part).replaceAll("~", "~0").replaceAll("/", "~1")}`).join(""),
      reason: issue.message,
      code: issue.code,
    }));
    throw new AppError(message, 400, undefined, undefined, { invalid_params: invalidParams });
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

/**
 * An optional "YYYY-MM-DD" query parameter that must also be a **real calendar date**.
 *
 * The regex alone accepts "2026-02-30", and `Date.parse` quietly rolls that over to March 2 — so a
 * range would silently start two days late instead of failing. Round-tripping through an ISO string
 * catches it. Empty counts as "not given", same as booleanQueryParam.
 *
 * macro/route.ts and stock/route.ts each still carry a module-local copy of the bare regex; they were
 * written before this existed and only check the format, not the calendar.
 */
export function dateQueryParam(name: string) {
  return z.preprocess(
    (v) => (v === undefined || v === "" ? undefined : v),
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, { error: `"${name}" must be in "YYYY-MM-DD" format` })
      .refine(
        (v) => {
          // 月份 13 這種值會得到 Invalid Date，而它的 toISOString() 會直接丟 RangeError——不先擋掉的話，
          // 一個呼叫端打錯的日期會變成 500 而不是 400。
          const date = new Date(`${v}T00:00:00Z`);
          return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === v;
        },
        { error: `"${name}" is not a real calendar date` },
      )
      .optional(),
  );
}
