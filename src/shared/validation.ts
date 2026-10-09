import { z, type ZodType } from "zod";
import { AppError } from "@/domain/appError.js";

/**
 * Validates `body` against `schema`, throwing a 400 AppError (bff-ts's own `{ error: { message } }`
 * envelope) with a field-level message on failure instead of letting a malformed request reach the
 * service layer as ad hoc `as { field?: unknown }` casts + scattered manual checks.
 */
export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  return parseInput(schema, body, "body");
}

/**
 * Same as parseBody for `req.query`. The only difference is how each RFC 9457 `errors` item points at the
 * culprit: a JSON Pointer locates a spot in request *content*, which a query string isn't, so query
 * failures name the `parameter` instead (the convention the conductor's RFC 9457 guide records).
 */
export function parseQuery<T>(schema: ZodType<T>, query: unknown): T {
  return parseInput(schema, query, "query");
}

function parseInput<T>(schema: ZodType<T>, body: unknown, location: "body" | "query"): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "(body)"}: ${issue.message}`)
      .join("; ");
    // RFC 9457 §3 自己範例的形狀（2026-10-08）：`errors: [{ detail, pointer }]`，pointer 是 URI fragment 形式的
    // RFC 6901 JSON Pointer（"#/rows/0/price"）。一開始用的 invalid_params 是被它取代的 RFC 7807 範例，同一天改正。
    // 前端靠 pointer／parameter 分支，不必拿 regex 去拆上面那句 detail。
    const errors = result.error.issues.map((issue) =>
      location === "query"
        ? { detail: issue.message, parameter: issue.path.map(String).join(".") }
        : { detail: issue.message, pointer: `#${issue.path.map((part) => `/${String(part).replaceAll("~", "~0").replaceAll("/", "~1")}`).join("")}` },
    );
    throw new AppError(message, 400, undefined, undefined, { errors });
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

/**
 * 選填的整數 query 參數，範圍 [min, max]；沒給或空字串＝沒給（undefined），route 只在有給時才轉發。每支歷史端點的
 * 上下限照 analysis-ts 那支端點自己的上限，不是全站一個數字。原本住在 stock/route.ts，2026-10-08 類股端點也要用，搬來共用。
 */
export function limitSchema(min: number, max: number, name = "limit") {
  return z.preprocess(
    (v) => (v === undefined || v === "" ? undefined : v),
    z
      .coerce.number({ error: `"${name}" must be an integer between ${min} and ${max}` })
      .refine((n) => Number.isInteger(n) && n >= min && n <= max, {
        message: `"${name}" must be an integer between ${min} and ${max}`,
      })
      .optional(),
  );
}
