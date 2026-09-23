import type { ColumnPresetsPort } from "@/application/ports/columnPresets.js";
import type { ColumnPresetTemplatesPort } from "@/application/ports/columnPresetTemplates.js";
import type { HoldingsPort } from "@/application/ports/holdings.js";
import type { MacroGatewayPort } from "@/application/ports/macroGateway.js";
import type { PresetTemplatesPort } from "@/application/ports/presetTemplates.js";
import type { ScreenerPresetsPort } from "@/application/ports/screenerPresets.js";
import type { TransactionsPort } from "@/application/ports/transactions.js";
import type { UserPort } from "@/application/ports/user.js";
import type { UserPreferencesPort } from "@/application/ports/userPreferences.js";
import type { WatchlistPort } from "@/application/ports/watchlist.js";

/**
 * 這個服務所有 port 的集合，也是 application 層唯一知道「外面有東西」的地方。
 *
 * 用法：每個 use case 宣告自己要哪幾個，例如
 *   `export type WatchlistDeps = Pick<AppDeps, "watchlist">`
 * 然後把 `deps` 當最後一個參數收。這比整包傳進去好在兩件事：讀函式簽章就知道它碰得到什麼（等同一份
 * 副作用清單），以及測試只需要假造用得到的那幾個，不用為了一個 use case 生出整個世界。
 *
 * 誰把介面對應到實作，全 repo 只有 src/bootstrap/deps.ts（跟測試的 fake）知道。
 */
export interface AppDeps {
  // --- 業務中台：這個服務自己擁有的資料 ---
  watchlist: WatchlistPort;
  holdings: HoldingsPort;
  transactions: TransactionsPort;
  user: UserPort;
  /** 五張以 firebaseUid 為鍵的偏好設定表，合成一個 port——為什麼不拆成五個見該檔案的說明。 */
  userPreferences: UserPreferencesPort;
  /** 使用者自存的篩選條件組合與顯示欄位組合，產品上成對但規則不同，所以是兩個 port。 */
  screenerPresets: ScreenerPresetsPort;
  columnPresets: ColumnPresetsPort;
  /** 兩份策展範本：唯讀、沒有 firebaseUid，「套用」時才會經由上面兩個 port 變成使用者自己的資料。 */
  presetTemplates: PresetTemplatesPort;
  columnPresetTemplates: ColumnPresetTemplatesPort;

  // --- 代理層：對 analysis-ts 的出站呼叫，一個切片一個 gateway ---
  macroGateway: MacroGatewayPort;
}
