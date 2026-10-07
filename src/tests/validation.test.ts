import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseBody } from "@/shared/validation.js";
import { AppError } from "@/domain/appError.js";

describe("parseBody", () => {
  it("400 帶 RFC 9457 invalid_params：name 是 JSON Pointer（含 ~0／~1 跳脫），code 是 zod 的 issue code", () => {
    const schema = z.object({ rows: z.array(z.object({ price: z.number() })), "a/b~c": z.string() });

    let error: AppError | undefined;
    try {
      parseBody(schema, { rows: [{ price: "x" }] });
    } catch (e) {
      error = e as AppError;
    }

    expect(error?.statusCode).toBe(400);
    expect(error?.extensions?.invalid_params).toEqual([
      { name: "/rows/0/price", reason: expect.any(String), code: "invalid_type" },
      { name: "/a~1b~0c", reason: expect.any(String), code: "invalid_type" },
    ]);
  });
});
