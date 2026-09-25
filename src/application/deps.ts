import type { ColumnPresetsPort } from "@/application/ports/columnPresets.js";
import type { ColumnPresetTemplatesPort } from "@/application/ports/columnPresetTemplates.js";
import type { EmailGatewayPort } from "@/application/ports/emailGateway.js";
import type { EtfScreenerGatewayPort } from "@/application/ports/etfScreenerGateway.js";
import type { HoldingsPort } from "@/application/ports/holdings.js";
import type { IndustriesGatewayPort } from "@/application/ports/industriesGateway.js";
import type { MacroGatewayPort } from "@/application/ports/macroGateway.js";
import type { MarketGatewayPort } from "@/application/ports/marketGateway.js";
import type { MetricCatalogPort } from "@/application/ports/metricCatalog.js";
import type { MetricCatalogGatewayPort } from "@/application/ports/metricCatalogGateway.js";
import type { PresetTemplatesPort } from "@/application/ports/presetTemplates.js";
import type { ScreenerGatewayPort } from "@/application/ports/screenerGateway.js";
import type { ScreenerPresetsPort } from "@/application/ports/screenerPresets.js";
import type { SecuritiesGatewayPort } from "@/application/ports/securitiesGateway.js";
import type { StockGatewayPort } from "@/application/ports/stockGateway.js";
import type { SubscriptionsPort } from "@/application/ports/subscriptions.js";
import type { SystemHealthPort } from "@/application/ports/systemHealth.js";
import type { TokenVerifierPort } from "@/application/ports/tokenVerifier.js";
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
  /** 訂閱列。只有讀——唯一的寫入者會是金流 webhook，見該 port 的說明。 */
  subscriptions: SubscriptionsPort;
  /** 從 analysis-ts 同步進來、存在這個服務自己 DB 裡的指標型錄（拉進來的那一端是下面的 gateway）。 */
  metricCatalog: MetricCatalogPort;

  // --- 對外通知 ---
  /**
   * 寄信。**不是代理層**——它不對 analysis-ts 說話，而是這個服務自己對使用者說話，所以放在這裡而不是
   * gateway 那一區。只收列舉好的信件種類，收不到自由文字，理由見該 port 的說明（投信投顧法）。
   */
  emailGateway: EmailGatewayPort;

  // --- 代理層：對 analysis-ts 的出站呼叫，一個切片一個 gateway ---
  macroGateway: MacroGatewayPort;
  marketGateway: MarketGatewayPort;
  /** 全 repo 最大的一個 port（23 個方法）——那是上游個股 API 的寬度，不是分類失敗，見該 port 的說明。 */
  stockGateway: StockGatewayPort;
  industriesGateway: IndustriesGatewayPort;
  securitiesGateway: SecuritiesGatewayPort;
  etfScreenerGateway: EtfScreenerGatewayPort;
  /** 選股引擎。含 /valuation/ranking——它路徑不同、實作在另一個檔案，但仍是同一個切片，見該 port 的說明。 */
  screenerGateway: ScreenerGatewayPort;
  /** 唯一一個不是「即時轉發」的 gateway：拉回來是為了寫進 metricCatalog，不是為了直接回給前端。 */
  metricCatalogGateway: MetricCatalogGatewayPort;

  // --- 平台能力：不屬於任何一個業務切片，但同樣是被注入的外部世界 ---
  /** 身分驗證。把「用 Firebase」壓縮成 bootstrap 的一行，http 與 application 都不再叫得出那個名字。 */
  tokenVerifier: TokenVerifierPort;
  /** 健康檢查的探針。只有探測，沒有 client——見該 port 為什麼不交出 PrismaClient。 */
  systemHealth: SystemHealthPort;
}
