export type TransactionAction = "BUY" | "SELL";

export interface StockTransaction {
  id: string;
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

/**
 * POST /transactions 的完整輸入。tradeDate 在這裡是 "YYYY-MM-DD" 字串（格式由
 * transactions.service.ts 的 assertValidTradeDate 把關），轉成 Date 是 infrastructure 的事。
 *
 * 型別原本住在 transactions.repository.ts，等於 application 與 http 都得 import infrastructure 才拿得到
 * 這個 DTO。它描述的是使用者意圖，不是 Prisma 的 data 形狀，本來就該住這裡。
 */
export interface TransactionInput {
  symbol: string;
  action: TransactionAction;
  quantity: number;
  price: number;
  fee: number;
  tax: number;
  tradeDate: string;
  note: string | null;
}

/** PATCH /transactions/:id 的部分更新。欄位省略代表「不動」，note 可以明確設成 null 清空。symbol 不可改。 */
export interface TransactionUpdate {
  action?: TransactionAction;
  quantity?: number;
  price?: number;
  fee?: number;
  tax?: number;
  tradeDate?: string;
  note?: string | null;
}
