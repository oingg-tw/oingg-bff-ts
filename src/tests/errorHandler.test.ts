import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "ultimate-express";
import { AppError, errorHandler, jsonBodyErrorHandler, notFoundHandler } from "@/shared/errorHandler.js";

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
  it("responds with the AppError's own status code, message, and details", () => {
    const res = createMockResponse();
    const error = new AppError("watchlist item 1 not found", 404);

    errorHandler(error, {} as Request, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: { message: "watchlist item 1 not found", details: undefined },
    });
  });

  it("hides unexpected errors behind a generic 500 message", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = createMockResponse();

    errorHandler(new Error("something broke"), {} as Request, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: { message: "Internal server error" } });

    vi.restoreAllMocks();
  });
});
