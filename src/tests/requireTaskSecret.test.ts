import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction } from "ultimate-express";
import { requireTaskSecret } from "../shared/requireTaskSecret.js";

const ORIGINAL_TASK_SECRET = process.env.TASK_SECRET;

function mockReq(overrides: { headers?: Record<string, unknown>; query?: Record<string, unknown> } = {}) {
  return { headers: overrides.headers ?? {}, query: overrides.query ?? {} } as never;
}

describe("requireTaskSecret", () => {
  const res = {} as never;
  let next: NextFunction;

  beforeEach(() => {
    next = vi.fn() as unknown as NextFunction;
    process.env.TASK_SECRET = "correct-secret";
  });

  afterEach(() => {
    process.env.TASK_SECRET = ORIGINAL_TASK_SECRET;
  });

  it("calls next() with no error when the x-task-secret header matches", () => {
    requireTaskSecret(mockReq({ headers: { "x-task-secret": "correct-secret" } }), res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it("calls next() with no error when the task_secret query param matches (header absent)", () => {
    requireTaskSecret(mockReq({ query: { task_secret: "correct-secret" } }), res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it("rejects with 401 when the header value is wrong", () => {
    requireTaskSecret(mockReq({ headers: { "x-task-secret": "wrong-secret" } }), res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it("rejects with 401 when neither header nor query param is present (no crash)", () => {
    requireTaskSecret(mockReq(), res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  // Regression: timingSafeEqual throws (not returns false) when the two buffers differ in length —
  // must be guarded, or a mismatched-length secret would 500 instead of a clean 401.
  it("rejects with 401 (not a crash) when the provided secret has a different length than the real one", () => {
    requireTaskSecret(mockReq({ headers: { "x-task-secret": "short" } }), res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it("fails closed with 500 when TASK_SECRET isn't configured server-side, even with a correct-looking header", () => {
    delete process.env.TASK_SECRET;

    requireTaskSecret(mockReq({ headers: { "x-task-secret": "anything" } }), res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500 }));
  });

  it("strips wrapping quotes from TASK_SECRET before comparing (docker/Cloud Run env vars don't auto-strip)", () => {
    process.env.TASK_SECRET = '"correct-secret"';

    requireTaskSecret(mockReq({ headers: { "x-task-secret": "correct-secret" } }), res, next);

    expect(next).toHaveBeenCalledWith();
  });
});
