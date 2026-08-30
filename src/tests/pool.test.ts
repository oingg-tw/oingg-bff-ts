import { beforeEach, describe, expect, it, vi } from "vitest";

const PoolConstructor = vi.fn();

vi.mock("pg", () => ({
  Pool: class {
    constructor(...args: unknown[]) {
      PoolConstructor(...args);
    }
    async end() {}
  },
}));

import { closeNeonPools, initNeonPools } from "../adapters/neon/pool.js";

// Regression test: pg's own defaults leave connectionTimeoutMillis unset (unbounded wait to acquire a
// connection) and no idleTimeoutMillis (idle connections never recycled) — per the microservice DB
// connection best-practices review, every pool must fail fast on exhaustion instead of queuing forever.
describe("initNeonPools", () => {
  beforeEach(async () => {
    PoolConstructor.mockClear();
    await closeNeonPools();
  });

  it("creates one pool per <NAME>_DATABASE_URL with explicit size/timeout bounds, not pg's unbounded defaults", () => {
    initNeonPools({
      TWSE_DATABASE_URL: "postgres://twse",
      TPEX_DATABASE_URL: "postgres://tpex",
    });

    expect(PoolConstructor).toHaveBeenCalledTimes(2);
    for (const call of PoolConstructor.mock.calls) {
      expect(call[0]).toMatchObject({
        max: 10,
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 60_000,
      });
    }
  });

  it("throws when no <NAME>_DATABASE_URL is configured, instead of silently creating zero pools", () => {
    expect(() => initNeonPools({})).toThrow(/No Neon database connections configured/);
  });
});
