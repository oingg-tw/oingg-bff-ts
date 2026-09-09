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

const filterMetricSchema = z.object({
  key: z.string(),
  name: z.string(),
  path: z.string(),
  description: z.string().nullish(),
  source: z.string().nullish(),
  unit: z.string().nullish(),
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
  path: "/filters",
  summary: "列出目前可用來 filter/screener 的分類、指標、欄位目錄",
  description:
    "從本服務自己的資料庫回傳，不會即時打 oingg-analysis-ts。每次啟動時向 oingg-analysis-ts 拉取一次最新目錄存進本地 DB——oingg-analysis-ts（數據中台）不知道這個服務存在，也不會主動通知任何變動，所以拉取的時機完全由這個服務自己決定，目前是每次啟動時。分類/指標/欄位的排序跟原始 /filters 回應一致。前端可以用這支 API 動態組出 screener 的篩選條件 UI 跟欄位選擇 UI（field 格式為 \"<metricCode>.<token>\"，直接對應 POST /screener 跟 POST/PATCH /screener/column-presets 需要的格式；\"stock.price\" 是唯一的例外——來自 twse/tpex，不在這份目錄裡，但一樣可以當 screener 的顯示欄位）。`fields` 陣列是從 analysis-ts 每個 metricCode 底下的 `validTokens`（唯一該信任的合法 token 清單）轉換來的，不是舊架構獨立命名的欄位，也不是自己拿 periodType/lookbackRange/samplingInterval/snapshotCadence 做交叉組合（部分指標如 beta 不是自由交叉，只有特定配對才有資料，這份目錄已經幫忙排除掉無效組合）。metric 的 `name`/`unit` 從 2026-09-09 起是 analysis-ts 提供的真實中文名稱/單位（例如「殖利率（交易所公告）」/「%」），category 的 `name` 同一天稍晚也補上了（例如 categoryKey \"dividend\" 對應「股利」）；個別 field（token）目前還沒有自己的顯示名稱，`name` 仍是 token 本身；`description`/`source` 目前一律是 null（analysis-ts 還沒提供這兩項）。",
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
  path: "/filters/sync",
  summary: "手動觸發重新拉取 oingg-analysis-ts 的 filter catalog（不用重啟整個服務）",
  description:
    "2026-09-09 新增——在這之前，analysis-ts 那邊調整分類/指標的中文顯示名稱時，bff-ts 只有在啟動時才會拉取一次最新目錄，導致每次文案異動都要重啟整個服務才會生效。這支端點讓一個持有共用密鑰的呼叫方（人或內部工具）主動觸發重新拉取，取代重啟。仍然是 bff-ts 主動去拉，不是 analysis-ts 推送過來——analysis-ts 完全不需要知道這支端點存在，維持「數據中台不知道業務中台存在」的邊界。用 `X-Filters-Sync-Secret` header 帶密鑰驗證，任何環境都 fail-closed（跟 /api-docs 的 Basic Auth 只在 production 生效不同——這支端點會真的寫資料庫，不是單純的偵查面問題）。同步邏輯跟啟動時完全一樣：如果 analysis-ts 這次回傳空的 categories（0 筆），會拒絕套用並回錯誤，不會把本地資料庫清空。",
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
