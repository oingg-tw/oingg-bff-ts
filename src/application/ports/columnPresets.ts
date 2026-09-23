import type { ColumnPresetRow, ColumnPresetUpdate } from "@/application/screener/columnPresets.types.js";

/**
 * 使用者自存顯示欄位組合（ColumnPreset）的持久化 port。實作住
 * infrastructure/prisma/repositories/columnPresets.repository.ts。
 *
 * 形狀刻意跟 ScreenerPresetsPort 對稱（list/find/create/update/remove/reorder/count），因為這兩張表在
 * 產品上就是一對：一個存「篩什麼」，一個存「看哪幾欄」，同樣是使用者自己的分頁、同樣可拖曳排序、
 * 同樣受額度限制。不合併成一個 port 是因為它們的擁有者雖同，規則卻不同——ColumnPreset 多一條「同一個
 * 使用者只能有一個 isDefault」的跨列規則（見 findDefault），ScreenerPreset 沒有。
 *
 * 跟其他使用者資料的 port 一樣，每個方法都吃 firebaseUid，讓「只能動自己的資料」是型別上省不掉的參數。
 */
export interface ColumnPresetsPort {
  list(firebaseUid: string): Promise<ColumnPresetRow[]>;

  /** null 代表那一列不存在（或不屬於這個使用者）——兩者對呼叫端是同一件事，刻意不區分。 */
  find(firebaseUid: string, id: string): Promise<ColumnPresetRow | null>;

  /** 這個使用者自己標為預設的那一組；沒標過就是 null。同一個使用者至多一列 isDefault，由寫入端維持。 */
  findDefault(firebaseUid: string): Promise<ColumnPresetRow | null>;

  /**
   * duplicate 走回傳值而不是丟 Prisma 的 P2002，理由同 ScreenerPresetsPort.create。
   *
   * 注意這裡的 duplicate 對兩個呼叫端意義不同：addColumnPreset（使用者自己命名）要翻成 409 給使用者看，
   * addColumnPresetWithName（套用範本）則是換個名字重試。差別在 use case，不在這一層。
   */
  create(
    firebaseUid: string,
    name: string,
    columns: string[],
    isDefault: boolean,
  ): Promise<{ ok: true; row: ColumnPresetRow } | { ok: false; reason: "duplicate" }>;

  /** 三種結果都是值不是例外，理由同 ScreenerPresetsPort.update。 */
  update(
    firebaseUid: string,
    id: string,
    update: ColumnPresetUpdate,
  ): Promise<{ ok: true; row: ColumnPresetRow } | { ok: false; reason: "not-found" | "duplicate" }>;

  /** false 代表沒有刪到任何列，不區分「不存在」與「不是你的」。 */
  remove(firebaseUid: string, id: string): Promise<boolean>;

  /** null 代表 orderedIds 不等於這個使用者當下的完整 id 集合，而且一列都沒寫——理由同 ScreenerPresetsPort.reorder。 */
  reorder(firebaseUid: string, orderedIds: string[]): Promise<ColumnPresetRow[] | null>;

  /** 額度檢查用的便宜 COUNT——見 ScreenerPresetsPort.count。 */
  count(firebaseUid: string): Promise<number>;
}
