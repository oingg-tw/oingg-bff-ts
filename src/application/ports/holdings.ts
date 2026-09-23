import type { Holding, HoldingUpdate } from "@/application/holdings/holdings.types.js";

/**
 * 使用者持股（庫存）的持久化 port。實作住 infrastructure/prisma/repositories/holdings.repository.ts。
 *
 * 跟 WatchlistPort 一樣，每個方法都吃 firebaseUid：讓「只能動自己的資料」變成型別上無法省略的參數，
 * 而不是靠呼叫端記得加 where 條件。
 *
 * 注意這個 port 刻意不碰 StockTransaction——Holding 與 StockTransaction 是獨立的（存量 vs 流量），
 * 不互相同步，這是決定好的設計，不是還沒做完。
 */
export interface HoldingsPort {
  list(firebaseUid: string): Promise<Holding[]>;

  /** null 代表那一列不存在（或不屬於這個使用者）——兩者對呼叫端是同一件事，刻意不區分。 */
  find(firebaseUid: string, id: string): Promise<Holding | null>;

  /**
   * 回傳 discriminated union 而不是讓 Prisma 的 unique violation 往上冒。
   *
   * 重構前 holdings.service.ts 自己 `catch` 了 `Prisma.PrismaClientKnownRequestError` 再比對錯誤碼
   * "P2002"——那等於 application 層知道自己被 Prisma 實作，換掉資料庫就會默默失效（錯誤不再是那個型別，
   * catch 不到，409 變成 500，而且沒有測試會紅）。把「這個 symbol 你已經有一筆了」翻譯成領域語彙是
   * infrastructure 的責任。
   */
  create(
    firebaseUid: string,
    symbol: string,
    quantity: number,
    averageCost: number,
    note: string | null,
  ): Promise<{ ok: true; holding: Holding } | { ok: false; reason: "duplicate" }>;

  /** null 同樣代表「沒有更新到任何列」，不區分「不存在」與「不是你的」。 */
  update(firebaseUid: string, id: string, update: HoldingUpdate): Promise<Holding | null>;

  /** false 代表沒有刪到任何列，同樣不區分「不存在」與「不是你的」。 */
  remove(firebaseUid: string, id: string): Promise<boolean>;
}
