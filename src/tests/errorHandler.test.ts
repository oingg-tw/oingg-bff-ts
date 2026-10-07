import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "ultimate-express";
import { errorHandler, jsonBodyErrorHandler, notFoundHandler } from "@/http/errorHandler.js";
import { AppError } from "@/domain/appError.js";

function createMockResponse() {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("AppError", () => {
  it("defaults to a 500 status and marks itself operational", () => {
    const error = new AppError("boom");
    expect(error.statusCode).toBe(500);
    expect(error.isOperational).toBe(true);
    expect(error.message).toBe("boom");
  });

  it("carries a custom status code and details", () => {
    const error = new AppError("not found", 404, { symbol: "2330" });
    expect(error.statusCode).toBe(404);
    expect(error.details).toEqual({ symbol: "2330" });
  });
});

describe("notFoundHandler", () => {
  it("forwards a 404 AppError naming the missing route", () => {
    const req = { method: "GET", originalUrl: "/nope" } as Request;
    const next = vi.fn();

    notFoundHandler(req, createMockResponse(), next as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0]?.[0] as unknown as AppError;
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(404);
    expect(error.message).toBe("Route not found: GET /nope");
  });
});

describe("jsonBodyErrorHandler", () => {
  // Mounted right behind express.json(), so a SyntaxError there can only be a malformed request body —
  // which used to fall through to a 500 ("Internal server error" on POST /screener, found 2026-09-22).
  it("converts a body-parser SyntaxError into a 400", () => {
    const next = vi.fn();

    jsonBodyErrorHandler(new SyntaxError('Unexpected token \',\' is not valid JSON'), {} as Request, createMockResponse(), next as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0]?.[0] as unknown as AppError;
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(400);
    expect(error.message).toBe("Request body is not valid JSON");
  });

  it("passes any other error through untouched so its own status survives", () => {
    const next = vi.fn();
    const upstream = new AppError("Screener endpoint returned 503", 502);

    jsonBodyErrorHandler(upstream, {} as Request, createMockResponse(), next as NextFunction);

    expect(next).toHaveBeenCalledWith(upstream);
  });
});

describe("errorHandler", () => {
  function problemResponse() {
    const res = { locals: {} } as Response;
    res.set = vi.fn().mockReturnValue(res);
    res.status = vi.fn().mockReturnValue(res);
    res.type = vi.fn().mockReturnValue(res);
    res.send = vi.fn().mockReturnValue(res);
    return res;
  }

  function sentBody(res: Response): Record<string, unknown> {
    return JSON.parse(vi.mocked(res.send).mock.calls[0]?.[0] as string) as Record<string, unknown>;
  }

  it("寫成 RFC 9457 problem+json：status 跟狀態列一致、instance 跟 X-Request-Id 同值、舊的 error 物件仍在", () => {
    const res = problemResponse();

    errorHandler(new AppError("Your plan allows 10 items", 403, { debug: true }, "quota_exceeded", { limit: 10, used: 10 }), {} as Request, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.type).toHaveBeenCalledWith("application/problem+json");
    const body = sentBody(res);
    const requestId = (res.locals as { requestId: string }).requestId;
    expect(res.set).toHaveBeenCalledWith("X-Request-Id", requestId);
    expect(body).toMatchObject({
      type: "about:blank",
      title: "Forbidden",
      status: 403,
      detail: "Your plan allows 10 items",
      instance: `urn:uuid:${requestId}`,
      code: "quota_exceeded",
      // 擴充成員在頂層、每個環境都送；details 只是除錯用，不會出現在頂層。
      limit: 10,
      used: 10,
      error: { message: "Your plan allows 10 items", code: "quota_exceeded" },
    });
    expect(body).not.toHaveProperty("details");
  });

  it("擴充成員蓋不掉標準成員", () => {
    const res = problemResponse();

    errorHandler(new AppError("x", 400, undefined, undefined, { status: 200, detail: "spoofed" }), {} as Request, res, vi.fn());

    expect(sentBody(res)).toMatchObject({ status: 400, detail: "x" });
  });

  it("hides unexpected errors behind a generic 500 problem", () => {
    const res = problemResponse();

    errorHandler(new Error("something broke"), {} as Request, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    const body = sentBody(res);
    expect(body).toMatchObject({ title: "Internal Server Error", status: 500, detail: "Internal server error" });
    expect(JSON.stringify(body)).not.toContain("something broke");
  });
});
