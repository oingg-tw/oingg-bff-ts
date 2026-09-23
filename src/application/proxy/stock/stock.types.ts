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

/**
 * One symbol's latest close, as returned by the batched prices lookup backing the screener's
 * "stock.price" display column.
 *
 * Declared here rather than beside that lookup's caller: it used to live in stock.service.ts, which
 * stockQuote.client.ts then imported for its return type — an application→infrastructure→application
 * cycle that dependency-cruiser flagged as no-circular. A type this shape belongs with the other wire
 * shapes of this slice anyway; this module imports nothing, so nothing can cycle back through it.
 *
 * Looser than StockPrice on purpose: this endpoint can return a null tradeDate (a symbol with no
 * price row at all), the quote endpoint's `price` object cannot.
 */
export interface ClosePrice {
  close: string | null;
  tradeDate: string | null;
}
