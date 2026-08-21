export type StockMarket = "twse" | "tpex";

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

export interface StockQuote {
  symbol: string;
  market: StockMarket;
  price: StockPrice | null;
  valuation: StockValuation | null;
}
