import { AppError } from "../../shared/errorHandler.js";
import { requireEnv } from "../../shared/env.js";
import type { ClosePrice } from "./stock.service.js";
import type { StockQuote } from "./stock.types.js";

const MAX_SYMBOLS_PER_PRICES_REQUEST = 100;

function isStockQuote(body: unknown): body is StockQuote {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const quote = body as Partial<StockQuote>;
  return typeof quote.symbol === "string" && "price" in quote && "valuation" in quote;
}

function isPricesResponse(body: unknown): body is { prices: Record<string, ClosePrice> } {
  return typeof body === "object" && body !== null && typeof (body as { prices?: unknown }).prices === "object";
}

/** Fetches a single stock's latest price/valuation from oingg-analysis-ts. Null on a 404 (unknown symbol in either market — analysis-ts checks both). */
export async function fetchStockQuote(symbol: string): Promise<StockQuote | null> {
  const url = new URL(`/stocks/${encodeURIComponent(symbol)}/quote`, requireEnv("FILTERS_SERVICE_URL"));

  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new AppError(
      `Could not reach the analysis service at ${url.toString()}: ${error instanceof Error ? error.message : String(error)}`,
      502,
    );
  }

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new AppError(`Stock quote endpoint returned ${response.status} for ${url.toString()}`, 502);
  }

  const body: unknown = await response.json();
  if (!isStockQuote(body)) {
    throw new AppError(`Stock quote endpoint response at ${url.toString()} is missing symbol/price/valuation`, 502);
  }

  return body;
}

/**
 * Batched close-price lookup for the screener's "stock.price" column. `symbols=` is an explicit,
 * bounded list (bff always passes exactly the current page's symbols, ≤ pageSize) — analysis-ts
 * confirmed this endpoint deliberately has no limit/count_only truncation for that reason: a symbol not
 * found is simply absent from the returned `prices` object (not silently dropped from a truncated
 * response), so "present = has data, absent = no data" is a safe rule here. The 100-symbol cap is a hard
 * 400 if exceeded, never a silent partial response — bff's page sizes never get close to it.
 */
export async function fetchStockPrices(symbols: string[]): Promise<Map<string, ClosePrice>> {
  if (symbols.length === 0) {
    return new Map();
  }
  if (symbols.length > MAX_SYMBOLS_PER_PRICES_REQUEST) {
    throw new AppError(
      `Requested ${symbols.length} symbols at once, but the stock prices endpoint caps at ${MAX_SYMBOLS_PER_PRICES_REQUEST}`,
      500,
    );
  }

  const url = new URL("/stocks/prices", requireEnv("FILTERS_SERVICE_URL"));
  url.searchParams.set("symbols", symbols.join(","));

  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new AppError(
      `Could not reach the analysis service at ${url.toString()}: ${error instanceof Error ? error.message : String(error)}`,
      502,
    );
  }

  if (!response.ok) {
    throw new AppError(`Stock prices endpoint returned ${response.status} for ${url.toString()}`, 502);
  }

  const body: unknown = await response.json();
  if (!isPricesResponse(body)) {
    throw new AppError(`Stock prices endpoint response at ${url.toString()} is missing a "prices" object`, 502);
  }

  return new Map(Object.entries(body.prices));
}
