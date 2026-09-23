import type { MetricCategory } from "@/application/metricCatalog/metricCatalog.types.js";

/**
 * 指標型錄在「這個服務自己的資料庫」裡的持久化 port。實作住
 * infrastructure/prisma/repositories/metricCatalog.repository.ts。
 *
 * 這個切片是全 repo 唯一同時需要兩個 port 的地方：資料從 analysis-ts 拉進來（MetricCatalogGatewayPort），
 * 存在這裡（本 port），對外服務時只讀這裡、絕不即時轉發上游。刻意拆成兩個而不是一個「同步 port」，是因為
 * 它們會因為完全不同的理由改變——換掉資料庫只動這一個，上游改合約只動另一個。
 *
 * 沒有 firebaseUid：型錄對所有人是同一份，不是使用者資料。
 */
export interface MetricCatalogPort {
  /** 依 category→metric→field 的策展順序回傳整份型錄，形狀與 analysis-ts 的來源回應相同。 */
  list(): Promise<MetricCategory[]>;

  /**
   * 以自然鍵 upsert 整份型錄，只刪掉新型錄裡真的不存在的列——不是 delete 全部再重建。
   *
   * 這個語意是 port 合約的一部分，不是實作細節：MetricDefinitionField 對 ScreenerPresetFilter 有
   * `onDelete: Cascade`，一次「刪光再建回同樣的列」會連帶毀掉每個使用者存好的篩選條件（見
   * [[feedback_no_destructive_syncs]]）。任何新的實作都必須維持這個保證，所以它寫在介面上。
   */
  replace(categories: MetricCategory[]): Promise<void>;
}
