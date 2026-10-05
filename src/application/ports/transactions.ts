import type {
  ImportedTransaction,
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

  /**
   * 刪掉這個使用者在這個代號底下的**所有**交易，回傳刪掉的筆數。DELETE /holdings/:symbol 用它。
   *
   * 2026-10-05 加的：持股變成交易的投影之後，「刪掉一檔持股」沒有別的意思可以表達。
   * where 同時帶 firebaseUid 與 symbol——不是空的 where，刪除範圍永遠被使用者與代號夾住。
   */
  removeBySymbol(firebaseUid: string, symbol: string): Promise<number>;

  /**
   * 批次匯入。**一次全寫或全不寫**，而且已經存在的 `(firebaseUid, source, externalRef)` 要跳過
   * 而不是整批失敗——使用者重匯一份有重疊期間的檔案是正常操作，不是錯誤。
   *
   * 回傳實際寫入的筆數；`rows.length` 減掉它就是被跳過的重複筆數。
   */
  createManyImported(firebaseUid: string, importId: string, rows: readonly ImportedTransaction[]): Promise<number>;

  /**
   * 這批 `externalRef` 裡哪些已經存在。dryRun 要在**不寫入**的情況下算出 inserted／duplicates，
   * 所以兩條路徑都走這一支，報出來的數字才會一致（createManyImported 的 skipDuplicates 只是併發
   * 情況下的第二道防線，不是計數的來源）。
   */
  existingExternalRefs(firebaseUid: string, source: string, refs: readonly string[]): Promise<string[]>;

  /** 撤銷整批匯入，回傳刪掉的筆數。where 同時帶 firebaseUid，刪除範圍永遠被使用者夾住。 */
  removeByImportId(firebaseUid: string, importId: string): Promise<number>;

  /** 整批撤銷前要先驗 replay，所以得先知道這批影響到哪些代號。 */
  listByImportId(firebaseUid: string, importId: string): Promise<StockTransaction[]>;
}
