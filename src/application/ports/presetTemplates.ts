import type { PresetTemplate } from "@/application/presetTemplates/presetTemplates.types.js";

/**
 * 策展篩選範本（PresetTemplate）的讀取 port。實作住
 * infrastructure/prisma/repositories/presetTemplates.repository.ts。
 *
 * 只有讀，沒有寫：這張表是策展資料，由 prisma/seedPresetTemplates.ts 灌進去，不是使用者產生的內容。
 * 種子腳本是獨立的一次性程式，直接用 repository 就好，不必為了它在這個 port 上開一個 API 端點永遠
 * 用不到的寫入方法。
 *
 * 也因此這裡沒有 firebaseUid——範本對所有人是同一份。「套用範本」才是使用者資料，那一步走的是
 * ScreenerPresetsPort（見 presetTemplates.service.ts 的 applyPresetTemplate）。
 */
export interface PresetTemplatesPort {
  /** 依策展順序（position）回傳全部，不依 tier 過濾——誰看得到哪些是前端的事。 */
  list(): Promise<PresetTemplate[]>;

  /** null 代表沒有這個 id 的範本。 */
  find(id: string): Promise<PresetTemplate | null>;
}
