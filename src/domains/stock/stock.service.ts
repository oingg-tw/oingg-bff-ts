import { queryNeon } from "../../adapters/neon/index.js";
import type { StockMarket, StockPrice, StockQuote, StockValuation } from "./stock.types.js";

const MARKETS: StockMarket[] = ["twse", "tpex"];

interface PriceRow {
  tradeDate: Date;
  close: string | null;
}

interface ValuationRow {
  tradeDate: Date;
  peRatio: string | null;
  pbRatio: string | null;
  dividendYield: string | null;
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function findLatestPrice(market: StockMarket, symbol: string): Promise<StockPrice | null> {
  const result = await queryNeon<PriceRow>(
    market,
    'select "tradeDate", close from daily_price where symbol = $1 order by "tradeDate" desc limit 1',
    [symbol],
  );
  const row = result.rows[0];
  return row ? { tradeDate: toDateString(row.tradeDate), close: row.close } : null;
}

async function findLatestValuation(market: StockMarket, symbol: string): Promise<StockValuation | null> {
  const result = await queryNeon<ValuationRow>(
    market,
    'select "tradeDate", "peRatio", "pbRatio", "dividendYield" from daily_valuation where symbol = $1 order by "tradeDate" desc limit 1',
    [symbol],
  );
  const row = result.rows[0];
  return row
    ? {
        tradeDate: toDateString(row.tradeDate),
        peRatio: row.peRatio,
        pbRatio: row.pbRatio,
        dividendYield: row.dividendYield,
      }
    : null;
}

async function findQuoteInMarket(market: StockMarket, symbol: string): Promise<StockQuote | null> {
  const [price, valuation] = await Promise.all([
    findLatestPrice(market, symbol),
    findLatestValuation(market, symbol),
  ]);

  if (!price && !valuation) {
    return null;
  }

  return { symbol, market, price, valuation };
}

/**
 * A symbol belongs to exactly one market (listed symbols don't overlap between
 * TWSE and TPEx), so both markets are checked in parallel and whichever has data wins.
 */
export async function getStockQuote(symbol: string): Promise<StockQuote | null> {
  const quotes = await Promise.all(MARKETS.map((market) => findQuoteInMarket(market, symbol)));
  return quotes.find((quote) => quote !== null) ?? null;
}

async function findLatestClosePricesInMarket(
  market: StockMarket,
  symbols: string[],
): Promise<Map<string, string | null>> {
  const result = await queryNeon<{ symbol: string; close: string | null }>(
    market,
    `select distinct on (symbol) symbol, close
     from daily_price
     where symbol = any($1)
     order by symbol, "tradeDate" desc`,
    [symbols],
  );
  return new Map(result.rows.map((row) => [row.symbol, row.close]));
}

/**
 * Batched equivalent of calling getStockQuote() once per symbol for just the close price — used by the
 * screener to attach "stock.price" to a whole result set. One query per market (2 total) regardless of
 * how many symbols matched, instead of one query per symbol: a 50-row screener result used to fire 200
 * individual queries (2 markets x 2 tables x 50 symbols) at the twse/tpex DBs.
 */
export async function getLatestClosePrices(symbols: string[]): Promise<Map<string, string | null>> {
  if (symbols.length === 0) {
    return new Map();
  }

  const perMarket = await Promise.all(MARKETS.map((market) => findLatestClosePricesInMarket(market, symbols)));
  const merged = new Map<string, string | null>();
  for (const marketPrices of perMarket) {
    for (const [symbol, close] of marketPrices) {
      merged.set(symbol, close);
    }
  }
  return merged;
}

export type ValuationRankingMetric = "peRatio" | "pbRatio" | "dividendYield";

export interface ValuationRankingRow {
  symbol: string;
  value: string;
}

// peRatio/pbRatio <= 0 means a loss (negative EPS) or negative book equity, not "cheap" — it's a company
// with a real financial problem, and letting it through would fill a "lowest P/E" ranking with distressed
// companies instead of what the ranking is actually for. dividendYield has no equivalent negative case
// (no dividend is 0, not negative), so it isn't excluded. Same rule oingg-analysis-ts's own
// GET /valuation/ranking already uses (confirmed with them directly) — kept consistent on purpose.
const EXCLUDE_NON_POSITIVE: Record<ValuationRankingMetric, boolean> = {
  peRatio: true,
  pbRatio: true,
  dividendYield: false,
};

const VALUATION_RANKING_COLUMN: Record<ValuationRankingMetric, string> = {
  peRatio: "peRatio",
  pbRatio: "pbRatio",
  dividendYield: "dividendYield",
};

async function findValuationRankingInMarket(
  market: StockMarket,
  metric: ValuationRankingMetric,
  direction: "asc" | "desc",
  limit: number,
): Promise<ValuationRankingRow[]> {
  const column = VALUATION_RANKING_COLUMN[metric];
  const excludeNonPositive = EXCLUDE_NON_POSITIVE[metric];
  const havingCondition = excludeNonPositive ? "value > 0" : "value IS NOT NULL";

  const result = await queryNeon<{ symbol: string; value: string }>(
    market,
    `
    SELECT symbol, value FROM (
      SELECT DISTINCT ON (symbol) symbol, "${column}" AS value
      FROM daily_valuation
      WHERE "tradeDate" IS NOT NULL
      ORDER BY symbol, "tradeDate" DESC
    ) latest
    WHERE ${havingCondition}
    ORDER BY value ${direction === "asc" ? "ASC" : "DESC"}
    LIMIT $1
    `,
    [limit],
  );
  return result.rows;
}

/**
 * Top-N ranking by P/E, P/B, or dividend yield, queried directly from twse/tpex's own `daily_valuation`
 * instead of the analysis DB's `valuation_market_ratios` — the latter is only populated as oingg-analysis-ts
 * lazily computes each symbol, so it currently only covers a couple of symbols, while `daily_valuation`
 * already has same-day figures for the whole market (~870-1080 TWSE symbols, ~670-890 TPEx, per real DB
 * counts checked 2026-08-30). oingg-analysis-ts shipped its own GET /valuation/ranking the same day
 * covering this exact use case, but from TWSE's `daily_valuation` only — this covers both markets, which
 * a "market-wide ranking" needs. Each market is queried already sorted and LIMITed to `limit` rows (a
 * valid streaming-merge: neither market can contribute more than `limit` rows to the true combined top-N),
 * then merged and re-sorted in memory — cheap for at most 2*limit rows, avoids pulling every symbol.
 */
export async function getValuationRanking(
  metric: ValuationRankingMetric,
  direction: "asc" | "desc",
  limit: number,
): Promise<ValuationRankingRow[]> {
  const perMarket = await Promise.all(
    MARKETS.map((market) => findValuationRankingInMarket(market, metric, direction, limit)),
  );
  const merged = perMarket.flat();
  merged.sort((a, b) => (direction === "asc" ? Number(a.value) - Number(b.value) : Number(b.value) - Number(a.value)));
  return merged.slice(0, limit);
}
