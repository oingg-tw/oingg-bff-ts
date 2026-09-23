import { describe, expect, it, vi } from "vitest";
import { assertSymbolExists } from "@/application/proxy/stock/stock.service.js";
import { fakeStockGateway } from "@/tests/fakes/analysisGateways.js";

/**
 * This file used to be ~400 lines of "getX delegates to fetchX and returns its result as-is", asserted
 * against 17 vi.mock'd client modules. Those wrappers are gone (the routes call StockGatewayPort
 * directly), and so are the tests: a test that a one-line pass-through passes through only ever
 * restated the implementation.
 *
 * Nothing is left uncovered by the deletion — each client keeps its own *.client.test.ts covering the
 * part that actually has rules (URL/query building, the 400 relay, the field normalizers), and the
 * routes' validation lives in the zod schemas. What remains here is the one function in the slice that
 * makes a decision.
 */
describe("assertSymbolExists", () => {
  it("resolves silently when the symbol has a quote", async () => {
    const stockGateway = fakeStockGateway({
      getStockQuote: vi.fn().mockResolvedValue({ symbol: "2330", price: null, valuation: null }),
    });

    await expect(assertSymbolExists("2330", { stockGateway })).resolves.toBeUndefined();
    expect(stockGateway.getStockQuote).toHaveBeenCalledWith("2330");
  });

  // A quote with no price/valuation rows still counts as a real symbol — "exists" is about the symbol
  // being known to analysis-ts, not about it having traded.
  it("throws a 404 AppError when the symbol doesn't exist in either market", async () => {
    const stockGateway = fakeStockGateway({ getStockQuote: vi.fn().mockResolvedValue(null) });

    await expect(assertSymbolExists("NOPE", { stockGateway })).rejects.toMatchObject({
      statusCode: 404,
      message: 'Unknown stock symbol "NOPE"',
    });
  });
});
