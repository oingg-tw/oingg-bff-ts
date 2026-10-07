import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseBody, parseQuery } from "@/shared/validation.js";
import type { AppError } from "@/domain/appError.js";

function caught(fn: () => unknown): AppError | undefined {
  try {
    fn();
  } catch (e) {
    return e as AppError;
  }
  return undefined;
}

describe("parseBody / parseQuery", () => {
  it("body 的錯誤是 RFC 9457 §3 的 errors：pointer 是 URI fragment 形式的 JSON Pointer（含 ~0／~1 跳脫）", () => {
    const schema = z.object({ rows: z.array(z.object({ price: z.number() })), "a/b~c": z.string() });

    const error = caught(() => parseBody(schema, { rows: [{ price: "x" }] }));

    expect(error?.statusCode).toBe(400);
    expect(error?.extensions?.errors).toEqual([
      { detail: expect.any(String), pointer: "#/rows/0/price" },
      { detail: expect.any(String), pointer: "#/a~1b~0c" },
    ]);
  });

  it("query 的錯誤用 parameter 指名，不用 pointer（查詢字串不是請求內容）", () => {
    const error = caught(() => parseQuery(z.object({ ratio: z.enum(["pe", "pb"]) }), { ratio: "xx" }));

    expect(error?.extensions?.errors).toEqual([{ detail: expect.any(String), parameter: "ratio" }]);
  });
});
