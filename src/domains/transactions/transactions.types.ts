export type TransactionAction = "BUY" | "SELL";

export interface StockTransaction {
  id: number;
  symbol: string;
  action: TransactionAction;
  quantity: number;
  price: string;
  fee: string;
  tax: string;
  tradeDate: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}
