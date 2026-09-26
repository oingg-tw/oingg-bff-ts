import { AppError } from "@/domain/appError.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/infrastructure/analysisApi/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type { ClosePrice, StockQuote } from "@/application/proxy/stock/stock.types.js";

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

/**
 * analysis-ts's quote/prices endpoints send ratio/percentage fields as JSON numbers (verified live:
 * `close: 2420`, `peRatio: 28.05`) — confirmed with them this is their real, existing convention for
 * Decimal-backed fields generally (not something new to this endpoint): only BigInt-backed raw-amount
 * fields come as strings on their side, out of JSON-serialization necessity, not a "numbers are strings"
 * design choice.
 *
 * bff-ts's own screener values happen to already be strings (e.g. `{"value": "6.97"}`) — but that's
 * `node-postgres`'s default behavior for NUMERIC/DECIMAL columns (no custom type parser is registered
 * anywhere in this codebase — verified), not a deliberate app-level convention either. Normalizing here
 * is bff-ts choosing consistency across its own outward API surface despite that, not "restoring" some
 * rule analysis-ts is supposed to already follow.
 */
function toStringOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function normalizePrice(price: unknown): { tradeDate: string; close: string | null } | null {
  if (typeof price !== "object" || price === null) {
    return null;
  }
  const p = price as { tradeDate?: unknown; close?: unknown };
  return { tradeDate: String(p.tradeDate), close: toStringOrNull(p.close) };
}

function normalizeValuation(
  valuation: unknown,
): { tradeDate: string; peRatio: string | null; pbRatio: string | null; dividendYield: string | null } | null {
  if (typeof valuation !== "object" || valuation === null) {
    return null;
  }
  const v = valuation as { tradeDate?: unknown; peRatio?: unknown; pbRatio?: unknown; dividendYield?: unknown };
  return {
    tradeDate: String(v.tradeDate),
    peRatio: toStringOrNull(v.peRatio),
    pbRatio: toStringOrNull(v.pbRatio),
    dividendYield: toStringOrNull(v.dividendYield),
  };
}

function normalizeStockQuote(quote: StockQuote): StockQuote {
  return {
    symbol: quote.symbol,
    price: normalizePrice(quote.price),
    valuation: normalizeValuation(quote.valuation),
  };
}

function normalizeClosePrice(price: ClosePrice): ClosePrice {
  return { close: toStringOrNull(price.close), tradeDate: price.tradeDate === null ? null : String(price.tradeDate) };
}

/** Fetches a single stock's latest price/valuation from oingg-analysis-ts. Null on a 404 (unknown symbol in either market — analysis-ts checks both). */
export async function fetchStockQuote(symbol: string): Promise<StockQuote | null> {
  const url = buildAnalysisServiceUrl(`/stocks/${encodeURIComponent(symbol)}/quote`);
  const response = await fetchAnalysisService(url);

  if (response.status === 404) {
    return null;
  }
  assertAnalysisServiceOk(response, url, "Stock quote endpoint");

  const body: unknown = await response.json();
  if (!isStockQuote(body)) {
    logger.error({ url: url.toString() }, "Stock quote endpoint response is missing symbol/price/valuation");
    throw new AppError("Stock quote endpoint response is missing symbol/price/valuation", 502);
  }

  return normalizeStockQuote(body);
}

/**
 * Batched close-price lookup for the screener's "stock.price" column. `symbols=` is an explicit, bounded
 * list — analysis-ts confirmed this endpoint deliberately has no limit/count_only truncation for that
 * reason: a symbol not found is simply absent from the returned `prices` object (not silently dropped
 * from a truncated response), so "present = has data, absent = no data" is a safe rule here, and it stays
 * safe across the batching below because merging batches only ever adds keys.
 *
 * The cap is per *request*, so this function chunks instead of refusing. It used to throw a 500 above 100
 * symbols, on the stated assumption that "bff's page sizes never get close to it" — that assumption was
 * simply wrong: MAX_PAGE_SIZE is 200, twice the cap. Any `POST /screener` with `pageSize` over 100 that
 * asked for the `stock.price` column returned a 500 (measured live 2026-09-26, every page, every filter).
 * `/screener/values` had the same ceiling (MAX_VALUES_SYMBOLS is 200). `GET /screener/ranking` did not —
 * MAX_RANKING_LIMIT is 50 — so it was never affected, but it shares this code path and would have been the
 * moment that limit was raised. Chunking here rather than in mergeStockPrices fixes every caller at once:
 * this is the only place that knows what the upstream limit is, so it's the only place that should care.
 *
 * Note the contrast with fetchExDividendNotices, which keeps its 100-symbol limit as a hard 400: there the
 * caller supplies the symbol list, so the cap is part of that endpoint's public contract. Here bff-ts
 * builds the list itself out of its own page size, so there is no caller to report the limit to — a
 * refusal could only ever be bff-ts's own bug, which is exactly what it was.
 */
export async function fetchStockPrices(symbols: string[]): Promise<Map<string, ClosePrice>> {
  if (symbols.length === 0) {
    return new Map();
  }

  const batches: string[][] = [];
  for (let i = 0; i < symbols.length; i += MAX_SYMBOLS_PER_PRICES_REQUEST) {
    batches.push(symbols.slice(i, i + MAX_SYMBOLS_PER_PRICES_REQUEST));
  }

  const results = await Promise.all(batches.map(fetchOneBatchOfStockPrices));
  return new Map(results.flatMap((batch) => [...batch]));
}

async function fetchOneBatchOfStockPrices(symbols: string[]): Promise<Map<string, ClosePrice>> {
  const url = buildAnalysisServiceUrl("/stocks/prices", { symbols: symbols.join(",") });
  const response = await fetchAnalysisService(url);
  assertAnalysisServiceOk(response, url, "Stock prices endpoint");

  const body: unknown = await response.json();
  if (!isPricesResponse(body)) {
    logger.error({ url: url.toString() }, 'Stock prices endpoint response is missing a "prices" object');
    throw new AppError('Stock prices endpoint response is missing a "prices" object', 502);
  }

  return new Map(Object.entries(body.prices).map(([symbol, price]) => [symbol, normalizeClosePrice(price)]));
}
