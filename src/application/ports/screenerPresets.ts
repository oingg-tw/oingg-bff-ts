import type { PresetFilterInput, PresetRow, PresetUpdate } from "@/application/screener/screenerPresets.types.js";

/**
 * 使用者自存篩選條件組合（ScreenerPreset）的持久化 port。實作住
 * infrastructure/prisma/repositories/screenerPresets.repository.ts。
 *
 * 跟 WatchlistPort/HoldingsPort 一樣，每個方法都吃 firebaseUid：讓「只能動自己的資料」變成型別上無法
 * 省略的參數，而不是靠呼叫端記得加 where 條件。
 *
 * 為什麼這個 port 有 count()：POST /screener/presets 的額度檢查是在 middleware 擋的，需要一個便宜的
 * COUNT 而不是把整包 preset 撈出來數。重構前路由直接 import repository 的 countPresets——那是 http 層
 * 認得 Prisma，跟 use case 直接 import repository 是同一種違規，只是換個地方發生。
 */
export interface ScreenerPresetsPort {
  list(firebaseUid: string): Promise<PresetRow[]>;

  /** null 代表那一列不存在（或不屬於這個使用者）——兩者對呼叫端是同一件事，刻意不區分。 */
  find(firebaseUid: string, id: string): Promise<PresetRow | null>;

  /**
   * 回傳 discriminated union 而不是讓 Prisma 的 unique violation 往上冒。
   *
   * 重構前 screenerPresets.service.ts 自己 `catch` 了 `Prisma.PrismaClientKnownRequestError` 再比對錯誤碼
   * "P2002"——那等於 application 層知道自己被 Prisma 實作，換掉資料庫就會默默失效（錯誤不再是那個型別，
   * catch 不到，重試迴圈變成直接噴 500 而且沒有測試會紅）。把「這個名字被搶走了」翻譯成領域語彙是
   * infrastructure 的責任。
   *
   * 這裡的 duplicate 不是錯誤而是預期路徑：use case 會挑一個新名字再試（見 createPresetWithAvailableName），
   * 因為 preset 撞名要像檔案總管一樣自動接 "名稱 2"，不是丟錯給使用者。
   */
  create(
    firebaseUid: string,
    name: string,
    filters: PresetFilterInput[],
    sectorCodes: string[],
    excludeSectorCodes: string[],
  ): Promise<{ ok: true; row: PresetRow } | { ok: false; reason: "duplicate" }>;

  /**
   * 三種結果都是值不是例外：改好了、那一列不是你的（或不存在）、改名撞到別人已經有的名字。
   * 後兩者在 use case 分別變成 404 與 409——同樣不讓 P2002 這個 Prisma 專屬錯誤碼漏進 application。
   */
  update(
    firebaseUid: string,
    id: string,
    update: PresetUpdate,
  ): Promise<{ ok: true; row: PresetRow } | { ok: false; reason: "not-found" | "duplicate" }>;

  /** false 代表沒有刪到任何列，不區分「不存在」與「不是你的」。 */
  remove(firebaseUid: string, id: string): Promise<boolean>;

  /**
   * 整批重排 position。null 代表 orderedIds 不等於這個使用者當下的完整 id 集合，而且一列都沒寫——
   * 局部重排是有歧義的（沒被列到的要排到哪？），所以要求整組，跟 PATCH 的 filters 同樣是「整包取代」。
   */
  reorder(firebaseUid: string, orderedIds: string[]): Promise<PresetRow[] | null>;

  /** 記住這組篩選條件上次是配哪一組欄位看的（見 proxy/screener/runPreset.ts）。 */
  setLastColumnPreset(firebaseUid: string, id: string, columnPresetId: string): Promise<void>;

  /** 額度檢查用的便宜 COUNT——不必把整包 preset 撈出來只為了跟上限比大小。 */
  count(firebaseUid: string): Promise<number>;
}
