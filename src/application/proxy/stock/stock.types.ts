export interface StockPrice {
  tradeDate: string;
  close: string | null;
}

export interface StockValuation {
  tradeDate: string;
  peRatio: string | null;
  pbRatio: string | null;
  dividendYield: string | null;
}

/**
 * No `market` (twse/tpex) field — analysis-ts's GET /stocks/:symbol/quote deliberately doesn't expose
 * which market a symbol belongs to (it checks both internally), and bff-ts no longer needs that concept
 * at all now that it isn't querying twse/tpex directly.
 */
export interface StockQuote {
  symbol: string;
  price: StockPrice | null;
  valuation: StockValuation | null;
}
