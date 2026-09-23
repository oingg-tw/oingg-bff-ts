import type { ColumnPresetTemplate } from "@/application/columnPresetTemplates/columnPresetTemplates.types.js";

/**
 * 策展欄位範本（ColumnPresetTemplate）的讀取 port。實作住
 * infrastructure/prisma/repositories/columnPresetTemplates.repository.ts。
 *
 * 跟 PresetTemplatesPort 一樣只有讀、也沒有 firebaseUid：這張表是 bff-ts 自己策展的（analysis-ts
 * 2026-09-08 起不再提供 columnPresets），由 prisma/seedColumnPresetTemplates.ts 以自然鍵 upsert 寫入，
 * 那支腳本直接用 repository。
 *
 * findDefault 是這個 port 存在的主因之一：整個 screener 在「使用者沒指定也沒有預設」時要顯示哪幾欄，
 * 答案來自這裡的 isDefault 那一列（見 columnPresets.service.ts 的 resolveDefaultColumns），而不是寫死
 * 在程式裡的欄位陣列——預設值是活的常數，改一次全站生效。
 */
export interface ColumnPresetTemplatesPort {
  /** 依策展順序（position）回傳全部。 */
  list(): Promise<ColumnPresetTemplate[]>;

  /** null 代表沒有這個 key 的範本。 */
  find(key: string): Promise<ColumnPresetTemplate | null>;

  /**
   * 中性的「總覽」範本（見 ColumnPresetTemplate.isDefault）。null 代表種子還沒跑或那一列被刪了，
   * 呼叫端會退成「沒有欄位」而不是整個請求炸掉。
   */
  findDefault(): Promise<ColumnPresetTemplate | null>;
}
