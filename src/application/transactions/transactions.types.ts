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
  /** 批次匯入的來源命名空間；手動輸入是 null。見 schema.prisma 的說明。 */
  source: string | null;
  /** 來源系統裡那一列的識別字串（券商 CSV 是 "YYYY-MM-DD|委託書號"）；手動輸入是 null。 */
  externalRef: string | null;
  /** 同一次匯入共用，用於整批撤銷；手動輸入是 null。 */
  importId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * POST /transactions/import 要寫進去的一列。跟 TransactionInput 的差別是三個冪等／撤銷用的欄位，
 * 以及 `createdAt` 由服務層**明確指派**而不是交給資料庫的 default now()。
 *
 * 為什麼要自己指派 createdAt：replay 的同日第二排序鍵就是它（見 domain/holdingProjection.ts），
 * 而一次 createMany 的所有列會拿到同一個 now()——那樣之後每次重算的排序都是未定義的，同一份資料
 * 可能算出不同的均價。匯入排序完才逐列指派，讓儲存下來的資料自己就能重現同一個答案。
 */
export interface ImportedTransaction extends TransactionInput {
  source: string;
  externalRef: string;
  createdAt: Date;
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
