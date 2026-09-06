import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockIsProduction = false;

vi.mock("@/shared/env.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/env.js")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      get isProduction() {
        return mockIsProduction;
      },
    },
  };
});

const { requireApiDocsAuth } = await import("@/adapters/swagger/apiDocsAuth.js");

const ORIGINAL_USER = process.env.API_DOCS_USER;
const ORIGINAL_PASSWORD = process.env.API_DOCS_PASSWORD;

function basicAuthHeader(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

function mockRes() {
  return {
    set: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as unknown as import("ultimate-express").Response;
}

beforeEach(() => {
  process.env.API_DOCS_USER = "dev";
  process.env.API_DOCS_PASSWORD = "dev-local-secret";
});

afterEach(() => {
  mockIsProduction = false;
  if (ORIGINAL_USER === undefined) {
    delete process.env.API_DOCS_USER;
  } else {
    process.env.API_DOCS_USER = ORIGINAL_USER;
  }
  if (ORIGINAL_PASSWORD === undefined) {
    delete process.env.API_DOCS_PASSWORD;
  } else {
    process.env.API_DOCS_PASSWORD = ORIGINAL_PASSWORD;
  }
});

describe("requireApiDocsAuth outside production", () => {
  beforeEach(() => {
    mockIsProduction = false;
  });

  // web-nuxt's sandboxed dev environment can't complete a Basic Auth challenge — this check is skipped
  // entirely outside production (2026-09-06), so no env vars or credentials are needed at all here.
  it("calls next() unconditionally, even with no Authorization header", () => {
    const req = { headers: {} } as import("ultimate-express").Request;
    const res = mockRes();
    const next = vi.fn();

    requireApiDocsAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("calls next() unconditionally even when API_DOCS_USER/API_DOCS_PASSWORD aren't configured", () => {
    delete process.env.API_DOCS_USER;
    delete process.env.API_DOCS_PASSWORD;
    const req = { headers: {} } as import("ultimate-express").Request;
    const res = mockRes();
    const next = vi.fn();

    expect(() => requireApiDocsAuth(req, res, next)).not.toThrow();
    expect(next).toHaveBeenCalledOnce();
  });
});

describe("requireApiDocsAuth in production", () => {
  beforeEach(() => {
    mockIsProduction = true;
  });

  it("calls next() when the Authorization header has the correct credentials", () => {
    const req = { headers: { authorization: basicAuthHeader("dev", "dev-local-secret") } } as import("ultimate-express").Request;
    const res = mockRes();
    const next = vi.fn();

    requireApiDocsAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects with 401 and a WWW-Authenticate header when no Authorization header is given", () => {
    const req = { headers: {} } as import("ultimate-express").Request;
    const res = mockRes();
    const next = vi.fn();

    requireApiDocsAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.set).toHaveBeenCalledWith("WWW-Authenticate", expect.stringContaining("Basic"));
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects with 401 when the password is wrong", () => {
    const req = { headers: { authorization: basicAuthHeader("dev", "wrong") } } as import("ultimate-express").Request;
    const res = mockRes();
    const next = vi.fn();

    requireApiDocsAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects with 401 when the user is wrong", () => {
    const req = { headers: { authorization: basicAuthHeader("nope", "dev-local-secret") } } as import("ultimate-express").Request;
    const res = mockRes();
    const next = vi.fn();

    requireApiDocsAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects with 401 when the Authorization header isn't Basic auth", () => {
    const req = { headers: { authorization: "Bearer sometoken" } } as import("ultimate-express").Request;
    const res = mockRes();
    const next = vi.fn();

    requireApiDocsAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("throws (fails closed) when API_DOCS_USER isn't configured", () => {
    delete process.env.API_DOCS_USER;
    const req = { headers: {} } as import("ultimate-express").Request;
    const res = mockRes();
    const next = vi.fn();

    expect(() => requireApiDocsAuth(req, res, next)).toThrow(/API_DOCS_USER/);
  });

  it("throws (fails closed) when API_DOCS_PASSWORD isn't configured", () => {
    delete process.env.API_DOCS_PASSWORD;
    const req = { headers: {} } as import("ultimate-express").Request;
    const res = mockRes();
    const next = vi.fn();

    expect(() => requireApiDocsAuth(req, res, next)).toThrow(/API_DOCS_PASSWORD/);
  });

  it("strips wrapping quotes from env values (docker --env-file compatibility)", () => {
    process.env.API_DOCS_USER = '"dev"';
    process.env.API_DOCS_PASSWORD = "'dev-local-secret'";
    const req = { headers: { authorization: basicAuthHeader("dev", "dev-local-secret") } } as import("ultimate-express").Request;
    const res = mockRes();
    const next = vi.fn();

    requireApiDocsAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });
});
