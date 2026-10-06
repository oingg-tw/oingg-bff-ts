import type { HoldingColumn } from "@/application/user/holdingColumns.types.js";
import type { WatchlistColumn } from "@/application/user/watchlistColumns.types.js";
import type { PreferredStocksColumnPreset } from "@/application/user/preferredStocksPreferences.types.js";
import type { StockDetailPageMode } from "@/application/user/stockDetailPreferences.types.js";
import type {
  MarketColorConvention,
  ThemeAccentColor,
  ThemeMode,
  ThemePreferenceUpdate,
} from "@/application/user/theme.types.js";

/**
 * 使用者偏好設定的持久化 port——theme / screener 顯示 / dashboard 卡片 / 個股頁 / 特別股頁五張表，
 * 一個介面。實作住 infrastructure/prisma/repositories/ 底下對應的五個 repository。
 *
 * 為什麼是一個 port 而不是五個：五張表雖然欄位不同，但形狀是同一件事——以 firebaseUid 為唯一鍵的
 * 1:1 偏好列，恰好一個 get 一個 save，沒有查詢、沒有列表、沒有跨列規則。拆成五個介面會得到五個彼此
 * 幾乎一樣的兩方法介面，讓 AppDeps 從「這個服務有哪些能力」退化成「資料庫有哪些表」的清單（六個
 * 條目裡五個講同一件事）。所以改成方法名帶上表名（getTheme/saveTheme、getDashboardCards/…），
 * 讀 AppDeps 看到的是 `userPreferences` 一項，讀方法名一樣清楚知道碰的是哪一張表。
 *
 * 代價誠實講：宣告 `Pick<AppDeps, "userPreferences">` 的 use case 型別上摸得到全部五組方法，不像
 * WatchlistPort 那樣一個 use case 只拿得到自己那一塊。會接受這個代價是因為這五張表的擁有者、存取條件
 * （只能動自己的）與變更時機完全一致；哪天某一張表長出自己的查詢或跨使用者規則（例如需要列出全部、
 * 或被別的切片讀），那一張就該獨立成自己的 port，而不是繼續長在這裡。
 *
 * 跟 WatchlistPort/HoldingsPort 一樣，每個方法都吃 firebaseUid：讓「只能動自己的資料」變成型別上無法
 * 省略的參數，而不是靠呼叫端記得加 where 條件。
 *
 * 所有 get* 的回傳型別都是「儲存的樣子」而不是「API 回傳的樣子」——欄位可以是 null，代表使用者從來
 * 沒有明確選過。把 null 解析成當下的系統預設值是 use case 的規則（見各 service 的 SYSTEM_DEFAULT_*），
 * 不是這一層的：預設值是活的常數，不該在寫入時被凍進資料列裡。
 */
export interface UserPreferencesPort {
  /** null 代表整列不存在；欄位為 null 代表那一個設定沒被明確選過。兩者都由 use case 解析成系統預設值。 */
  getTheme(firebaseUid: string): Promise<StoredThemePreference | null>;

  /** 部分更新：只寫 update 帶到的欄位，其餘維持原狀（四個 PUT 端點各自獨立，互不覆寫）。 */
  saveTheme(firebaseUid: string, update: ThemePreferenceUpdate): Promise<StoredThemePreference>;

  getScreenerDisplaySettings(firebaseUid: string): Promise<StoredScreenerDisplaySettings | null>;
  saveScreenerDisplaySettings(firebaseUid: string, showAsOfDate: boolean): Promise<StoredScreenerDisplaySettings>;

  getDashboardCards(firebaseUid: string): Promise<StoredDashboardCardSettings | null>;
  saveDashboardCards(firebaseUid: string, visibleCardIds: string[]): Promise<StoredDashboardCardSettings>;

  getStockDetailPreferences(firebaseUid: string): Promise<StoredStockDetailPreferences | null>;
  /**
   * `mode` 與 `visibleCardIds` 一起整包覆寫，沒有部分更新——web-nuxt 的設定 popover 一向同時存兩者。
   *
   * `pinnedMetricSlugs` 是**唯一的例外**：傳 `undefined` 代表「不要動這一欄」，傳 `[]` 代表「使用者
   * 取消了所有釘選」。這個例外存在的理由是部署順序——這一欄 2026-09-25 才加，而 web-nuxt 現有的
   * client 只送兩個欄位；若把它做成必填，他們在改好之前每一次 PUT 都會 400，而若把缺席當成 `[]`，
   * 他們每存一次設定就會把釘選清空。「不送就不動」讓兩邊誰先上都不會壞。
   *
   * 他們改完之後三個欄位一律都送，那條分支就不會再被走到；**它是過渡用的，不是給未來的部分更新
   * 預留空間**——`mode`/`visibleCardIds` 的整包覆寫語意沒有改。
   */
  saveStockDetailPreferences(
    firebaseUid: string,
    mode: StockDetailPageMode,
    visibleCardIds: string[],
    pinnedMetricSlugs: string[] | undefined,
  ): Promise<StoredStockDetailPreferences>;

  /** 持股頁自訂欄位。null＝沒有列（從來沒存過）。 */
  getHoldingColumns(firebaseUid: string): Promise<HoldingColumn[] | null>;
  /** 整份覆蓋，順序就是顯示順序。 */
  saveHoldingColumns(firebaseUid: string, columns: HoldingColumn[]): Promise<HoldingColumn[]>;

  /** 自選股表格的顯示欄位。null＝沒有列（從來沒存過）。 */
  getWatchlistColumns(firebaseUid: string): Promise<WatchlistColumn[] | null>;
  /** 整份覆蓋，順序就是顯示順序。 */
  saveWatchlistColumns(firebaseUid: string, columns: WatchlistColumn[]): Promise<WatchlistColumn[]>;

  getPreferredStocksPreferences(firebaseUid: string): Promise<StoredPreferredStocksPreferences | null>;
  /** 同樣是整包覆寫，理由跟 saveStockDetailPreferences 一樣。 */
  savePreferredStocksPreferences(
    firebaseUid: string,
    columnPresetId: PreferredStocksColumnPreset,
    columnOrder: string[],
  ): Promise<StoredPreferredStocksPreferences>;
}

/** 四個欄位各自獨立可為 null：使用者只設過其中一個時，其餘仍要落回當下的系統預設值。 */
export interface StoredThemePreference {
  mode: ThemeMode | null;
  accentColor: ThemeAccentColor | null;
  marketColorConvention: MarketColorConvention | null;
  isFullWidth: boolean | null;
}

export interface StoredScreenerDisplaySettings {
  showAsOfDate: boolean | null;
}

export interface StoredDashboardCardSettings {
  /** 這一列存在就一定有值；[] 是「使用者把每張卡都關掉了」，跟「整列不存在」是兩件事。 */
  visibleCardIds: string[];
}

export interface StoredStockDetailPreferences {
  mode: StockDetailPageMode;
  visibleCardIds: string[];
  /** 這一欄可為 null（既有的列沒有它），跟 visibleCardIds 不同——理由見 schema.prisma 的註解。 */
  pinnedMetricSlugs: string[] | null;
}

export interface StoredPreferredStocksPreferences {
  columnPresetId: PreferredStocksColumnPreset;
  columnOrder: string[];
}
