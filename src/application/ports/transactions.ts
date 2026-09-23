import type {
  StockTransaction,
  TransactionInput,
  TransactionUpdate,
} from "@/application/transactions/transactions.types.js";

/**
 * 使用者交易紀錄的持久化 port。實作住 infrastructure/prisma/repositories/transactions.repository.ts。
 *
 * 跟 WatchlistPort 一樣，每個方法都吃 firebaseUid：讓「只能動自己的資料」變成型別上無法省略的參數，
 * 而不是靠呼叫端記得加 where 條件。
 *
 * 這裡沒有 create 的 duplicate 分支，是因為交易紀錄本來就允許重複——同一天同一檔買兩次是正常的，
 * 沒有 unique constraint 可違反。不要為了跟 HoldingsPort 對稱就補一個永遠走不到的分支。
 */
export interface TransactionsPort {
  /** symbol 省略時回傳全部；排序是 tradeDate desc、同日再 id desc（呼叫端直接照單輸出）。 */
  list(firebaseUid: string, symbol?: string): Promise<StockTransaction[]>;

  /** null 代表那一列不存在（或不屬於這個使用者）——兩者對呼叫端是同一件事，刻意不區分。 */
  find(firebaseUid: string, id: string): Promise<StockTransaction | null>;

  create(firebaseUid: string, input: TransactionInput): Promise<StockTransaction>;

  /** null 代表沒有更新到任何列，不區分「不存在」與「不是你的」。 */
  update(firebaseUid: string, id: string, update: TransactionUpdate): Promise<StockTransaction | null>;

  /** false 代表沒有刪到任何列，同樣不區分「不存在」與「不是你的」。 */
  remove(firebaseUid: string, id: string): Promise<boolean>;
}
