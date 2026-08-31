import { Router } from "ultimate-express";
import { getFilterCatalog } from "./filterCatalog.service.js";

export const filterCatalogRouter = Router();

/**
 * @swagger
 * /filters:
 *   get:
 *     summary: 列出目前可用來 filter/screener 的分類、指標、欄位目錄
 *     description: >
 *       從本服務自己的資料庫回傳，不會即時打 oingg-analysis-ts。每次啟動時向 oingg-analysis-ts 拉取一次
 *       最新目錄存進本地 DB——oingg-analysis-ts（數據中台）不知道這個服務存在，也不會主動通知任何變動，
 *       所以拉取的時機完全由這個服務自己決定，目前是每次啟動時。分類/指標/欄位的排序跟原始 /filters
 *       回應一致。
 *       前端可以用這支 API 動態組出 screener 的篩選條件 UI 跟欄位選擇 UI（field 格式為
 *       "<metricKey>.<fieldKey>"，直接對應 POST /screener 跟 POST/PATCH /screener/column-presets 需要的格式；
 *       "stock.price" 是唯一的例外——來自 twse/tpex，不在這份目錄裡，但一樣可以當 screener 的顯示欄位）。
 *
 *       每個 metric／field 都帶 `description`（這個數字的定義）跟 `source`（資料來源）——給前端在
 *       欄位標題或篩選條件卡片上加 info icon + tooltip 用（oingg-analysis-ts 目前在 metric 層級提供，
 *       field 沒有自己的值時會 fallback 用 metric 的）。
 *     tags:
 *       - Screener
 *     responses:
 *       200:
 *         description: 分類 / 指標 / 欄位清單（含 description/source）。伺服器剛啟動、還沒同步成功過時可能是空陣列。
 */
filterCatalogRouter.get("/", async (_req, res) => {
  const categories = await getFilterCatalog();
  res.json({ categories });
});
