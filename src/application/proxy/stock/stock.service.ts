import { AppError } from "@/domain/appError.js";
import type { AppDeps } from "@/application/deps.js";

/**
 * Only the one gateway, taken as the LAST argument — same convention as the 業務中台 services.
 *
 * This file used to hold 23 functions. All but the one below were `getX(args) => fetchX(args)` with no
 * validation or orchestration (this slice's parameter validation lives in the route's zod schemas, which
 * double as the OpenAPI source), so they were deleted rather than rewritten to take `deps`: the routes
 * now call StockGatewayPort directly. Same judgement as the macro slice.
 */
export type StockProxyDeps = Pick<AppDeps, "stockGateway">;

/**
 * Shared by the holdings/transactions/watchlist route handlers (業務中台) to confirm a symbol is real
 * before creating a row for it — kept on this side (bff) rather than called from inside those domains'
 * own services, since checking against a live quote is a call into this BFF's pass-through data, not
 * something the owning domain's CRUD service should reach across module boundaries for itself.
 *
 * This is the one function in the slice that earns its layer: it turns the gateway's "no such symbol"
 * null into a 404 with a specific message, which is a decision, not a relay. Note the message differs
 * from GET /stocks/:symbol's own 404 ("No stock data found for symbol ...") — that one answers "we have
 * nothing to show you", this one answers "you may not store this". Don't merge them.
 */
export async function assertSymbolExists(symbol: string, deps: StockProxyDeps): Promise<void> {
  const quote = await deps.stockGateway.getStockQuote(symbol);
  if (!quote) {
    throw new AppError(`Unknown stock symbol "${symbol}"`, 404);
  }
}
