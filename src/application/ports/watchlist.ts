import type { WatchlistItem } from "@/application/watchlist/watchlist.types.js";

/**
 * 使用者自選股清單的持久化 port。實作住 infrastructure/prisma/repositories/watchlist.repository.ts。
 *
 * 每個方法都吃 firebaseUid，不是為了方便而是為了安全：讓「只能動自己的資料」這件事變成型別上無法省略
 * 的參數，而不是靠呼叫端記得加 where 條件。BOLA 掃描（npm run security:check）驗過這個慣例。
 */
export interface WatchlistPort {
  list(firebaseUid: string): Promise<WatchlistItem[]>;
  find(firebaseUid: string, id: string): Promise<WatchlistItem | null>;

  /**
   * 回傳 discriminated union 而不是讓 Prisma 的 unique violation 往上冒。
   *
   * 重構前 watchlist.service.ts 自己 `catch` 了 `Prisma.PrismaClientKnownRequestError` 再比對錯誤碼
   * "P2002"——那等於 application 層知道自己被 Prisma 實作，換掉資料庫就會默默失效（錯誤不再是那個型別，
   * catch 不到，409 變成 500）。把「重複了」翻譯成領域語彙是 infrastructure 的責任，這個 port 的存在
   * 理由之一就是這件事。
   */
  create(
    firebaseUid: string,
    symbol: string,
    note: string | null,
  ): Promise<{ ok: true; item: WatchlistItem } | { ok: false; reason: "duplicate" }>;

  /** null 代表那一列不存在（或不屬於這個使用者）——兩者對呼叫端是同一件事，刻意不區分。 */
  updateNote(firebaseUid: string, id: string, note: string | null): Promise<WatchlistItem | null>;

  /** false 代表沒有刪到任何列，同樣不區分「不存在」與「不是你的」。 */
  remove(firebaseUid: string, id: string): Promise<boolean>;
}
