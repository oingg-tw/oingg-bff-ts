import { z } from "zod";
import { errorResponse, registry } from "@/http/swagger/registry.js";

const metricFieldSchema = z.object({
  key: z.string(),
  name: z.string(),
  period: z.string(),
  description: z.string().nullish(),
  source: z.string().nullish(),
  unit: z.string().nullish(),
  sort: z.number(),
});

interface MetricBadgePercentileRankDoc {
  scope: "market" | "sector";
  direction: "asc" | "desc";
  topPercent: number;
  excludeZero?: boolean;
}

const percentileRankSchema = z
  .object({
    scope: z.enum(["market", "sector"]),
    direction: z.enum(["asc", "desc"]),
    topPercent: z.number(),
    excludeZero: z.boolean().optional(),
  })
  .openapi("MetricBadgePercentileRank");

interface MetricBadgeThresholdDoc {
  description: string;
  denominator?: number;
  comparator?: "gt" | "lt" | "gte" | "lte" | "abs_lt" | "in_range";
  value?: number;
  valueMin?: number;
  valueMax?: number;
  compareAgainstFieldId?: string;
  allPositiveFieldIds?: string[];
  thresholdLatex?: string;
  note?: string;
  warning?: MetricBadgeThresholdDoc;
  percentileRank?: MetricBadgePercentileRankDoc;
}

// z.lazy for the self-referencing `warning` field (a threshold can nest one "danger zone" threshold of
// its own shape, added 2026-09-20 — so far only piotroskiFScore has one). Registered with .openapi(...) —
// without a name, zod-to-openapi tries to fully expand the self-reference and recurses infinitely (see
// chainTreeNodeSchema's now-removed precedent in industries.openapi.ts, which needed the same fix).
const metricBadgeThresholdSchema: z.ZodType<MetricBadgeThresholdDoc> = z.lazy(() =>
  z
    .object({
      description: z.string(),
      /** Required on a top-level threshold; omitted entirely (not repeated) on a nested `warning` threshold — see MetricBadgeThreshold.denominator. */
      denominator: z.number().optional(),
      comparator: z.enum(["gt", "lt", "gte", "lte", "abs_lt", "in_range"]).optional(),
      value: z.number().optional(),
      /** Only set (and only meaningful) when comparator is "in_range" — inclusive lower/upper bounds. */
      valueMin: z.number().optional(),
      valueMax: z.number().optional(),
      compareAgainstFieldId: z.string().optional(),
      allPositiveFieldIds: z.array(z.string()).optional(),
      /** LaTeX source for the threshold condition itself, display-only. */
      thresholdLatex: z.string().optional(),
      /** Free-text annotation about where/why this specific threshold value was chosen. */
      note: z.string().optional(),
      /** A secondary, stricter "danger zone" threshold. Absent on every badge except piotroskiFScore as of launch. Reuses the full threshold type for simplicity, but analysis-ts confirmed its real shape is narrower: only description/thresholdLatex/note/comparator ('gt'|'lt'|'gte'|'lte' only)/value — no denominator/valueMin/valueMax/compareAgainstFieldId/allPositiveFieldIds. */
      warning: metricBadgeThresholdSchema.optional(),
      /** A cross-sectional ranking threshold ("top N% of market/sector") — added 2026-09-21, mutually exclusive with comparator/value(Min/Max)/compareAgainstFieldId/allPositiveFieldIds above (a threshold has either a fixed-value shape or this one, never both — not enforced by this schema, just passed through as given). */
      percentileRank: percentileRankSchema.optional(),
    })
    .openapi("MetricBadgeThreshold"),
);

/**
 * **沒有 `id` 欄位是刻意的，不要補回來。** analysis-ts 2026-09-12 把徽章與指標的名稱欄位抽成共用型別時，
 * 確認 `id` 跟 `metricCode` 完全重複就從規格刪掉了，他們的型別與 OpenAPI 現在都沒有這一欄。
 * 要唯一識別一個徽章請用它所屬的 metricCode（徽章與指標是一對一）。
 *
 * 這裡曾經宣告成必填（錯的，實測 33 個徽章都沒有），2026-09-26 一度改成選填＋註明從未送出，
 * 確認上游已永久移除後才整個刪除——留一個永遠 undefined 的欄位只會讓下游照文件寫出拿不到值的程式碼。
 */
const metricBadgeSchema = z.object({
  name: z.string(),
  nameEn: z.string(),
  author: z.string(),
  summary: z.string(),
  detail: z.string(),
  /**
   * Absent when the threshold spans multiple periods instead of one (e.g. eps's allPositiveFieldIds).
   * 2026-09-26 實測：33 個徽章目前**全部都有** timeframe，所以那個情況現在沒有實例——維持選填，因為
   * eps 那種跨期門檻的形狀還在，不是上游承諾了必填。
   */
  timeframe: z.string().optional(),
  threshold: metricBadgeThresholdSchema,
  /** Public page verifying the threshold/formula — added 2026-09-20, 21/23 badge metrics have it (grossMargin/netProfitMargin deliberately excluded, book-only source). */
  sourceUrl: z.string().optional(),
});

const metricDefinitionSchema = z.object({
  key: z.string(),
  name: z.string(),
  /**
   * 英文縮寫。2026-09-26 新增（analysis-ts commit 747feb18），起因是使用者要求「指標要有 ROIC」，
   * 決定的做法是中文名稱不動、縮寫放這一欄。
   */
  nameEn: z
    .string()
    .nullish()
    .openapi({
      description:
        "這個指標的英文縮寫（ROIC、PER、PBR、EBIT Margin…）。2026-09-26 新增。**用途是搜尋與副標，不是顯示名稱的替代品**——" +
        "`name` 仍是主要的中文名稱（例如 roic 的 name 是「投入資本報酬率」、nameEn 是「ROIC」），把 nameEn 當主標會讓中文使用者看不懂那是什麼指標。" +
        "典型用法是讓使用者搜「ROIC」也能找到「投入資本報酬率」。" +
        "**選填而且會長期選填**：目前 64 支有值（2026-09-26 一次補了 28 支，含 eps=EPS、roe=ROE、roic=ROIC、peRatio/exchangePeRatio=PER、" +
        "pbRatio/exchangePbRatio=PBR、evEbitda=EV/EBITDA 等），其餘是 null，上游沒有承諾補齊時程。不要假設它一定存在。",
    }),
  path: z.string(),
  description: z.string().nullish(),
  source: z.string().nullish(),
  /** What this metric can't tell you — null except on the ~35 badge-bearing metrics analysis-ts has one for (2026-09-19). */
  limitations: z.string().nullish(),
  /** Common ways this metric gets misread/misapplied — same badge-metrics-first coverage as limitations (2026-09-19). */
  misreadings: z.string().nullish(),
  unit: z.string().nullish(),
  /** LaTeX formula source, read-only display only — null until analysis-ts documents this metric's formula (pilot rollout, 2026-09-10). */
  formulaLatex: z.string().nullish(),
  /** External reference URL (e.g. Wikipedia) — null until analysis-ts documents one for this metric (2026-09-10). */
  referenceUrl: z.string().nullish(),
  /** Original academic paper URL — distinct from referenceUrl (general-reader vs. academic source). Null except on the ~13 metrics analysis-ts has one for (2026-09-10). */
  academicSourceUrl: z.string().nullish(),
  /** Curated "guru badge" methodology threshold — null except on the ~11 metrics analysis-ts has one for (2026-09-10). */
  badge: metricBadgeSchema.nullish(),
  /** Data-provenance category labels (fixed 9-label vocabulary) — always present and non-empty, unlike formulaLatex/referenceUrl/badge (2026-09-10). */
  sources: z.array(z.string()),
  /** Whether GET /stocks/:symbol/metric-provenance supports this metricCode — a growing allowlist (12 metrics at launch, 2026-09-13). */
  hasProvenance: z.boolean(),
  /** Current formula version (integer, ≥1) — bumps when the metric's computation changes meaning; the same value analysis-ts stamps on metric_values rows. Added 2026-09-22, present on every metric. */
  formulaVersion: z.number().int(),
  sort: z.number(),
  fields: z.array(metricFieldSchema),
});

const metricCategorySchema = z
  .object({
    key: z.string(),
    name: z.string(),
    sort: z.number(),
    metrics: z.array(metricDefinitionSchema),
  })
  .openapi("MetricCategory");

registry.registerPath({
  method: "get",
  path: "/metrics",
  summary: "列出目前可用來 filter/screener 的分類、指標、欄位目錄",
  description:
    "2026-09-10 從 /filters 改名為 /metrics（跟 oingg-analysis-ts 同一天的改名同步——他們認為回傳的是指標定義，不是篩選器本身，\"filters\" 名不符實，為了 ubiquitous language、避免跨團隊溝通時對同一份資料有兩種稱呼，bff-ts 這邊的對外路徑也跟著改，不只是內部呼叫改掉而已）。從本服務自己的資料庫回傳，不會即時打 oingg-analysis-ts。每次啟動時向 oingg-analysis-ts 拉取一次最新目錄存進本地 DB——oingg-analysis-ts（數據中台）不知道這個服務存在，也不會主動通知任何變動，所以拉取的時機完全由這個服務自己決定，目前是每次啟動時（也可以用 POST /metrics/sync 手動觸發，見下方）。分類/指標/欄位的排序跟原始 analysis-ts 回應一致。前端可以用這支 API 動態組出 screener 的篩選條件 UI 跟欄位選擇 UI（field 格式為 \"<metricCode>.<token>\"，直接對應 POST /screener 跟 POST/PATCH /screener/column-presets 需要的格式；\"stock.price\" 是唯一的例外——來自 twse/tpex，不在這份目錄裡，但一樣可以當 screener 的顯示欄位）。`fields` 陣列是從 analysis-ts 每個 metricCode 底下的 `validTimeframes`（唯一該信任的合法時間切法清單，2026-09-14 從 `validTokens` 改名，跟下面 metric-history 系列端點 token->timeframe 改名同一波）轉換來的，不是舊架構獨立命名的欄位，也不是自己拿 periodType/lookbackRange/samplingInterval/snapshotCadence 做交叉組合（部分指標如 beta 不是自由交叉，只有特定配對才有資料，這份目錄已經幫忙排除掉無效組合）。metric 的 `name`/`unit` 從 2026-09-09 起是 analysis-ts 提供的真實中文名稱/單位（例如「殖利率（交易所公告）」/「%」），category 的 `name` 同一天稍晚也補上了（例如 categoryKey \"dividend\" 對應「股利」）；個別 field（token）目前還沒有自己的顯示名稱，`name` 仍是 token 本身；`source`（單數，metric 層級的自由文字說明）目前一律是 null（analysis-ts 還沒提供這項）。metric 的 `description`（2026-09-19 起實際有值，欄位本身早就存在但先前 analysis-ts 一直沒送）、`limitations`（這個指標不能告訴你什麼，例如樣本數限制、存活者偏誤）、`misreadings`（常見誤讀/誤用情境）三個欄位同一天新增／開始有值，目前只有約 35 支有 badge 的指標有值，其餘一律是 null，之後會逐步補齊。metric 的 `formulaLatex`（2026-09-10 新增，試點）是這個指標公式的 LaTeX 原始碼，設計目的是前端唯讀渲染（例如 KaTeX/mathlive），確保跟 analysis-ts 實際算法一致，不要自己在前端重寫一份容易對不上的公式；**不是**拿來用 LaTeX compute engine 重新計算數值用的（analysis-ts 的真實數字是 bigint 精算，LaTeX compute engine 是浮點數）。目前只有少數指標有值，其餘一律是 null，之後會逐步補齊，前端要能處理「這支還沒有公式」的情況，不要因為缺這個欄位就出錯。metric 的 `referenceUrl`（2026-09-10 新增，跟 formulaLatex 同一天）是這個指標的外部參考連結（例如維基百科），目的是讓前端不用再自己維護一份 metric -> 來源連結的對照表（例如原本 web-nuxt 端硬編碼在 guru-badges.ts 裡），直接顯示 analysis-ts 提供的連結即可，避免同一份資訊要維護兩份。跟 formulaLatex 一樣，目前只有少數指標有值（例如 dividendPayoutRatio、dividendCoverageRatio、dividendYield），其餘一律是 null，前端一樣要能處理「這支還沒有參考連結」的情況。metric 的 `academicSourceUrl`（2026-09-10 新增，跟 referenceUrl 同一天但涵蓋範圍窄很多，約 13 個指標）**不是** referenceUrl 的重複欄位——analysis-ts 自己的說法：「referenceUrl 給一般讀者看的白話解釋，academicSourceUrl 給想找原始論文的人」，指向原始學術論文/出處文件（例如 sue 對應 Foster/Olsen/Shevlin 1984 論文的 DOI 連結，或 Basel III/IMF FSI 銀行比率指標對應的官方文件）。跟 formulaLatex/referenceUrl 一樣目前只有少數指標有值，其餘一律是 null。metric 的 `badge`（2026-09-10 新增，跟 formulaLatex/referenceUrl 同一波）是一個完整的「達人門檻」評分方法論物件（id/name/nameEn/author/summary/detail/token/threshold），原本是 web-nuxt 端硬編碼的 GURU_BADGES 對照表（11 筆），送給 analysis-ts 收錄進他們的 MetricDefinitionSpec 後原樣回傳，讓 web-nuxt 不用再自己維護一份。只出現在原本那 11 筆對照表涵蓋的指標上（altmanZScore、beneishMScore、ohlsonOScore、zmijewskiScore、grahamNumber、ncav、accrualsRatio、dividendPayoutRatio、sue、chowderNumber、eps），其餘一律是 null；Piotroski F-Score 經雙方協議刻意排除（它的 clamp/round 加上自訂 isMet 邏輯不符合 analysis-ts 的 threshold/comparator 詞彙），維持前端硬編碼，不在這個欄位裡。threshold 底下的 comparator/value/compareAgainstFieldId/allPositiveFieldIds 依評分方法論不同會出現不同組合（例如 grahamNumber/ncav 用 compareAgainstFieldId 跟股價比較，eps 用 allPositiveFieldIds 檢查多期都為正），原樣轉發，不做前端邏輯詮釋。`badge.timeframe`（2026-09-14 從 `badge.token` 改名，同一波 token->timeframe 改名）也可能不存在——當 threshold 本身橫跨多期（例如 eps 的 allPositiveFieldIds 同時檢查 \"eps.TTM\" 跟 \"eps.Q\"）就沒有單一時間切法可以標示，這種情況下 timeframe 整個欄位不會出現。`badge.sourceUrl`（2026-09-20 新增）是可以實際打開驗證門檻/公式內容的公開連結——沒有這個欄位以前前端只能拿 metric 層級的 referenceUrl 充數，兩者不一定指向同一個門檻的出處；目前 23 支有 badge 的指標裡 21 支有值（每個連結都人工開過確認過內容），grossMargin/netProfitMargin 這兩支刻意留空（門檻出自實體書，沒有合法免費全文可連）；缺席（不是空字串）代表還沒有可連結的公開出處。comparator 除了 gt/lt/gte/abs_lt 之外，2026-09-10 稍晚新增 \"in_range\"，2026-09-20 又新增 \"lte\"（gte 的另一半，piotroskiFScore 的 badge.threshold.warning 率先用到）（dividendPayoutRatio 的 Fidelity 區間更正——原本誤植成單邊 \"< 60%\"，實際上 Fidelity 報告的結論是 40%–60% 雙邊區間），搭配 `valueMin`/`valueMax`（含頭尾）取代單一 `value`，兩端都符合才算達標。`badge.threshold.percentileRank`（2026-09-21 新增）是另一種門檻形狀——橫斷面排名（例如「全市場前 20%」），有這個欄位時 comparator/value/valueMin/valueMax/compareAgainstFieldId/allPositiveFieldIds 都不會有值（analysis-ts 的說法：兩種門檻形狀互斥，一個 threshold 只會是固定值型或排名型其中一種），本服務不強制驗證互斥、原樣轉發；scope 是 'market'（全市場）或 'sector'（同類股），direction 是 'asc'/'desc'，topPercent 是百分比數字（例如 20 代表前 20%），excludeZero 選填、代表排名母體是否排除數值為零的公司。metric 的 `sources`（2026-09-10 新增）是資料來源類別標籤陣列（固定 9 種標籤的詞彙表，例如「公開發行公司資產負債表（XBRL）」、「證交所／櫃買中心每日收盤價」），跟上面的 `formulaLatex`/`referenceUrl`/`badge` 不同——這個欄位 analysis-ts 保證每個指標一定有值、不會是空陣列，不是「還沒補齊」的欄位，所以本服務這邊也當必填處理（缺這個欄位或格式不對會讓整次同步失敗，跟 displayName/unit/validTokens 同一等級，不會預設成 null）。跟既有的 `source`（單數，metric 層級的自由文字說明，analysis-ts 至今從未提供過）是兩個不同欄位，不要混淆。metric 的 `hasProvenance`（2026-09-13 新增）標示這個 metricCode 是否支援 GET /stocks/:symbol/metric-provenance（回溯到原始申報資料的稽核鏈）——這是會逐批擴大的名單（上線時 12 支：sue、chowderNumber、roe、accrualsRatio、dividendPayoutRatio、altmanZScore、dupontTaxBurden、dupontInterestBurden、inventoryTurnover、receivablesTurnover、fixedAssetTurnover、payablesTurnover），前端請讀這個欄位動態判斷要不要顯示查看資料來源的按鈕，不要自己寫死清單。metric 的 `formulaVersion`（2026-09-22 新增，每支必填、整數 ≥ 1）是這支指標目前的公式版本，跟 analysis-ts 寫進每筆 metric_values 的 formula_version 是同一個數字——公式語意一改就遞增（例如 sue 拿掉漂移項後是 3；roe／roa／assetTurnover／equityMultiplier／dupontDecomposedRoe／dupontExtendedRoe／sgr／netDebtToEbitda 分母改期間平均後是 2；其餘 1）。用途是給前端當「公式變了、文案要重讀」的明確訊號——formulaLatex 字串有時抽象到看不出語意改動，這個欄位才是可靠的判斷依據。另外常被問到：analysis-ts 上游的 `validTimeframes` 陣列在本服務並沒有以同名欄位透傳，而是轉成 `fields[]`（每個 token 一筆，`key` 跟 `period` 都是那個 token），兩者是同一份資料。",
  tags: ["Screener"],
  responses: {
    200: {
      description: "分類 / 指標 / 欄位清單（含 description/source）。伺服器剛啟動、還沒同步成功過時可能是空陣列。",
      content: { "application/json": { schema: z.object({ categories: z.array(metricCategorySchema) }) } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/metrics/sync",
  summary: "手動觸發重新拉取 oingg-analysis-ts 的指標目錄（不用重啟整個服務）",
  description:
    "2026-09-09 新增，2026-09-10 隨 GET /metrics 一起從 /filters/sync 改名——在 POST /metrics/sync 出現之前，analysis-ts 那邊調整分類/指標的中文顯示名稱時，bff-ts 只有在啟動時才會拉取一次最新目錄，導致每次文案異動都要重啟整個服務才會生效。這支端點讓一個持有共用密鑰的呼叫方（人或內部工具）主動觸發重新拉取，取代重啟。仍然是 bff-ts 主動去拉，不是 analysis-ts 推送過來——analysis-ts 完全不需要知道這支端點存在，維持「數據中台不知道業務中台存在」的邊界。用 `X-Filters-Sync-Secret` header 帶密鑰驗證（header/環境變數名稱維持不變，只有路徑改名），任何環境都 fail-closed（跟 /api-docs 的 Basic Auth 只在 production 生效不同——這支端點會真的寫資料庫，不是單純的偵查面問題）。同步邏輯跟啟動時完全一樣：如果 analysis-ts 這次回傳空的 categories（0 筆），會拒絕套用並回錯誤，不會把本地資料庫清空。",
  tags: ["Screener"],
  responses: {
    200: {
      description: "同步成功，回傳這次拉到的分類數/指標數。",
      content: { "application/json": { schema: z.object({ categoryCount: z.number(), metricCount: z.number() }) } },
    },
    401: errorResponse("缺少或錯誤的 X-Filters-Sync-Secret header。"),
    500: errorResponse("analysis-ts 服務無法連線，或這次回傳了空的 categories（0 筆，視為異常狀態，拒絕套用避免清空本地資料）。"),
  },
});
