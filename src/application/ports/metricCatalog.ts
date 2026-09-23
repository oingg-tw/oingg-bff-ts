import type {
  MetricCategory,
  MetricFieldLookup,
  MetricFieldRef,
} from "@/application/metricCatalog/metricCatalog.types.js";

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

  /**
   * 一次查好幾個欄位的顯示資訊，而不是一個欄位一個查詢。
   *
   * 「批次」寫在介面上而不是留給實作自由發揮，是因為它是效能合約的一部分：app DB 是遠端 Neon，一組
   * 五條件的 preset 若逐一驗證就要付五次網路往返（即使用 Promise.all 併發，每條查詢仍各自佔一條連線）。
   * 任何新實作都必須維持這個保證。
   *
   * 只回傳「找到的」那些。呼叫端自己拿要求的清單去比對，才知道哪一個是未知欄位——這讓「未知欄位」要回
   * 400 還是靜默略過（見 columnPresets.service.ts 的 resolveDefaultColumns）由呼叫端決定，而不是這裡。
   *
   * 這支 2026-09-24 metricCatalog 切片轉 port 時刻意沒放進來：當時它在切片內沒有呼叫者，放上來會是個
   * 沒人用的方法。真正的呼叫者是 screener 那幾個切片，所以它跟著那次轉換一起補上。
   */
  findFields(refs: MetricFieldRef[]): Promise<MetricFieldLookup[]>;
}
