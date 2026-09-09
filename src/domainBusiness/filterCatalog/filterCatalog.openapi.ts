import { z } from "zod";
import { registry } from "@/adapters/swagger/registry.js";

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
