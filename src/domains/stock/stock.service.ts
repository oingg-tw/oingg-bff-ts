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
