import { z } from "zod";
import { errorResponse, registry } from "@/adapters/swagger/registry.js";

const filterFieldSchema = z.object({
  key: z.string(),
  name: z.string(),
  period: z.string(),
  description: z.string().nullish(),
  source: z.string().nullish(),
  unit: z.string().nullish(),
  sort: z.number(),
});

const filterMetricBadgeThresholdSchema = z.object({
  description: z.string(),
  denominator: z.number(),
  comparator: z.enum(["gt", "lt", "gte", "abs_lt", "in_range"]).optional(),
  value: z.number().optional(),
  /** Only set (and only meaningful) when comparator is "in_range" — inclusive lower/upper bounds. */
  valueMin: z.number().optional(),
  valueMax: z.number().optional(),
  compareAgainstFieldId: z.string().optional(),
  allPositiveFieldIds: z.array(z.string()).optional(),
});

const filterMetricBadgeSchema = z.object({
  id: z.string(),
  name: z.string(),
  nameEn: z.string(),
  author: z.string(),
  summary: z.string(),
  detail: z.string(),
  /** Absent when the threshold spans multiple periods instead of one (e.g. eps's allPositiveFieldIds). */
  token: z.string().optional(),
  threshold: filterMetricBadgeThresholdSchema,
});

const filterMetricSchema = z.object({
  key: z.string(),
  name: z.string(),
  path: z.string(),
  description: z.string().nullish(),
  source: z.string().nullish(),
  unit: z.string().nullish(),
  /** LaTeX formula source, read-only display only — null until analysis-ts documents this metric's formula (pilot rollout, 2026-09-10). */
  formulaLatex: z.string().nullish(),
  /** External reference URL (e.g. Wikipedia) — null until analysis-ts documents one for this metric (2026-09-10). */
  referenceUrl: z.string().nullish(),
  /** Original academic paper URL — distinct from referenceUrl (general-reader vs. academic source). Null except on the ~13 metrics analysis-ts has one for (2026-09-10). */
  academicSourceUrl: z.string().nullish(),
  /** Curated "guru badge" methodology threshold — null except on the ~11 metrics analysis-ts has one for (2026-09-10). */
  badge: filterMetricBadgeSchema.nullish(),
  /** Data-provenance category labels (fixed 9-label vocabulary) — always present and non-empty, unlike formulaLatex/referenceUrl/badge (2026-09-10). */
  sources: z.array(z.string()),
  sort: z.number(),
  fields: z.array(filterFieldSchema),
});

const filterCategorySchema = z
  .object({
    key: z.string(),
    name: z.string(),
    sort: z.number(),
    metrics: z.array(filterMetricSchema),
  })
  .openapi("FilterCategory");

registry.registerPath({
  method: "get",
  path: "/metrics",
  summary: "列出目前可用來 filter/screener 的分類、指標、欄位目錄",
  description:
    "2026-09-10 從 /filters 改名為 /metrics（跟 oingg-analysis-ts 同一天的改名同步——他們認為回傳的是指標定義，不是篩選器本身，\"filters\" 名不符實，為了 ubiquitous language、避免跨團隊溝通時對同一份資料有兩種稱呼，bff-ts 這邊的對外路徑也跟著改，不只是內部呼叫改掉而已）。從本服務自己的資料庫回傳，不會即時打 oingg-analysis-ts。每次啟動時向 oingg-analysis-ts 拉取一次最新目錄存進本地 DB——oingg-analysis-ts（數據中台）不知道這個服務存在，也不會主動通知任何變動，所以拉取的時機完全由這個服務自己決定，目前是每次啟動時（也可以用 POST /metrics/sync 手動觸發，見下方）。分類/指標/欄位的排序跟原始 analysis-ts 回應一致。前端可以用這支 API 動態組出 screener 的篩選條件 UI 跟欄位選擇 UI（field 格式為 \"<metricCode>.<token>\"，直接對應 POST /screener 跟 POST/PATCH /screener/column-presets 需要的格式；\"stock.price\" 是唯一的例外——來自 twse/tpex，不在這份目錄裡，但一樣可以當 screener 的顯示欄位）。`fields` 陣列是從 analysis-ts 每個 metricCode 底下的 `validTokens`（唯一該信任的合法 token 清單）轉換來的，不是舊架構獨立命名的欄位，也不是自己拿 periodType/lookbackRange/samplingInterval/snapshotCadence 做交叉組合（部分指標如 beta 不是自由交叉，只有特定配對才有資料，這份目錄已經幫忙排除掉無效組合）。metric 的 `name`/`unit` 從 2026-09-09 起是 analysis-ts 提供的真實中文名稱/單位（例如「殖利率（交易所公告）」/「%」），category 的 `name` 同一天稍晚也補上了（例如 categoryKey \"dividend\" 對應「股利」）；個別 field（token）目前還沒有自己的顯示名稱，`name` 仍是 token 本身；`description`/`source` 目前一律是 null（analysis-ts 還沒提供這兩項）。metric 的 `formulaLatex`（2026-09-10 新增，試點）是這個指標公式的 LaTeX 原始碼，設計目的是前端唯讀渲染（例如 KaTeX/mathlive），確保跟 analysis-ts 實際算法一致，不要自己在前端重寫一份容易對不上的公式；**不是**拿來用 LaTeX compute engine 重新計算數值用的（analysis-ts 的真實數字是 bigint 精算，LaTeX compute engine 是浮點數）。目前只有少數指標有值，其餘一律是 null，之後會逐步補齊，前端要能處理「這支還沒有公式」的情況，不要因為缺這個欄位就出錯。metric 的 `referenceUrl`（2026-09-10 新增，跟 formulaLatex 同一天）是這個指標的外部參考連結（例如維基百科），目的是讓前端不用再自己維護一份 metric -> 來源連結的對照表（例如原本 web-nuxt 端硬編碼在 guru-badges.ts 裡），直接顯示 analysis-ts 提供的連結即可，避免同一份資訊要維護兩份。跟 formulaLatex 一樣，目前只有少數指標有值（例如 dividendPayoutRatio、dividendCoverageRatio、dividendYield），其餘一律是 null，前端一樣要能處理「這支還沒有參考連結」的情況。metric 的 `academicSourceUrl`（2026-09-10 新增，跟 referenceUrl 同一天但涵蓋範圍窄很多，約 13 個指標）**不是** referenceUrl 的重複欄位——analysis-ts 自己的說法：「referenceUrl 給一般讀者看的白話解釋，academicSourceUrl 給想找原始論文的人」，指向原始學術論文/出處文件（例如 sue 對應 Foster/Olsen/Shevlin 1984 論文的 DOI 連結，或 Basel III/IMF FSI 銀行比率指標對應的官方文件）。跟 formulaLatex/referenceUrl 一樣目前只有少數指標有值，其餘一律是 null。metric 的 `badge`（2026-09-10 新增，跟 formulaLatex/referenceUrl 同一波）是一個完整的「達人門檻」評分方法論物件（id/name/nameEn/author/summary/detail/token/threshold），原本是 web-nuxt 端硬編碼的 GURU_BADGES 對照表（11 筆），送給 analysis-ts 收錄進他們的 MetricDefinitionSpec 後原樣回傳，讓 web-nuxt 不用再自己維護一份。只出現在原本那 11 筆對照表涵蓋的指標上（altmanZScore、beneishMScore、ohlsonOScore、zmijewskiScore、grahamNumber、ncav、accrualsRatio、dividendPayoutRatio、sue、chowderNumber、eps），其餘一律是 null；Piotroski F-Score 經雙方協議刻意排除（它的 clamp/round 加上自訂 isMet 邏輯不符合 analysis-ts 的 threshold/comparator 詞彙），維持前端硬編碼，不在這個欄位裡。threshold 底下的 comparator/value/compareAgainstFieldId/allPositiveFieldIds 依評分方法論不同會出現不同組合（例如 grahamNumber/ncav 用 compareAgainstFieldId 跟股價比較，eps 用 allPositiveFieldIds 檢查多期都為正），原樣轉發，不做前端邏輯詮釋。`badge.token` 也可能不存在——當 threshold 本身橫跨多期（例如 eps 的 allPositiveFieldIds 同時檢查 \"eps.TTM\" 跟 \"eps.Q\"）就沒有單一 token 可以標示，這種情況下 token 整個欄位不會出現。comparator 除了 gt/lt/gte/abs_lt 之外，2026-09-10 稍晚新增 \"in_range\"（dividendPayoutRatio 的 Fidelity 區間更正——原本誤植成單邊 \"< 60%\"，實際上 Fidelity 報告的結論是 40%–60% 雙邊區間），搭配 `valueMin`/`valueMax`（含頭尾）取代單一 `value`，兩端都符合才算達標。metric 的 `sources`（2026-09-10 新增）是資料來源類別標籤陣列（固定 9 種標籤的詞彙表，例如「公開發行公司資產負債表（XBRL）」、「證交所／櫃買中心每日收盤價」），跟上面的 `formulaLatex`/`referenceUrl`/`badge` 不同——這個欄位 analysis-ts 保證每個指標一定有值、不會是空陣列，不是「還沒補齊」的欄位，所以本服務這邊也當必填處理（缺這個欄位或格式不對會讓整次同步失敗，跟 displayName/unit/validTokens 同一等級，不會預設成 null）。跟既有的 `source`（單數，metric 層級的自由文字說明，analysis-ts 至今從未提供過）是兩個不同欄位，不要混淆。",
  tags: ["Screener"],
  responses: {
    200: {
      description: "分類 / 指標 / 欄位清單（含 description/source）。伺服器剛啟動、還沒同步成功過時可能是空陣列。",
      content: { "application/json": { schema: z.object({ categories: z.array(filterCategorySchema) }) } },
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
