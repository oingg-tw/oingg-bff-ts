import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireFilterSyncSecret } from "@/domainBusiness/filterCatalog/filterSyncAuth.js";

const HEADER_NAME = "x-filters-sync-secret";
const ORIGINAL_SECRET = process.env.FILTERS_SYNC_SECRET;

function mockRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as unknown as import("ultimate-express").Response;
}

beforeEach(() => {
  process.env.FILTERS_SYNC_SECRET = "test-secret";
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.FILTERS_SYNC_SECRET;
  } else {
    process.env.FILTERS_SYNC_SECRET = ORIGINAL_SECRET;
  }
});

describe("requireFilterSyncSecret", () => {
  it("calls next() when the header matches the configured secret", () => {
    const req = { headers: { [HEADER_NAME]: "test-secret" } } as unknown as import("ultimate-express").Request;
    const res = mockRes();
    const next = vi.fn();

    requireFilterSyncSecret(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects with 401 when the header is missing", () => {
    const req = { headers: {} } as unknown as import("ultimate-express").Request;
    const res = mockRes();
    const next = vi.fn();

    requireFilterSyncSecret(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects with 401 when the header value is wrong", () => {
    const req = { headers: { [HEADER_NAME]: "wrong" } } as unknown as import("ultimate-express").Request;
    const res = mockRes();
    const next = vi.fn();

    requireFilterSyncSecret(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("fails closed (throws) when FILTERS_SYNC_SECRET isn't configured, even outside production", () => {
    delete process.env.FILTERS_SYNC_SECRET;
    const req = { headers: { [HEADER_NAME]: "anything" } } as unknown as import("ultimate-express").Request;
    const res = mockRes();
    const next = vi.fn();

    expect(() => requireFilterSyncSecret(req, res, next)).toThrow(/FILTERS_SYNC_SECRET/);
  });

  it("strips wrapping quotes from the configured secret (docker --env-file compatibility)", () => {
    process.env.FILTERS_SYNC_SECRET = '"test-secret"';
    const req = { headers: { [HEADER_NAME]: "test-secret" } } as unknown as import("ultimate-express").Request;
    const res = mockRes();
    const next = vi.fn();

    requireFilterSyncSecret(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });
});
