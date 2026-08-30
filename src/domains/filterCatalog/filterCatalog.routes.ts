import { Router } from "ultimate-express";
import { getFilterCatalog } from "./filterCatalog.service.js";

export const filterCatalogRouter = Router();

/**
 * @swagger
 * /filters:
 *   get:
 *     summary: 列出目前可用來 filter/screener 的分類、指標、欄位目錄
 *     description: >
 *       從本服務自己的資料庫回傳（啟動時已從 oingg-analysis-ts 的 /filters 同步過來），
 *       不會即時打 oingg-analysis-ts。分類/指標/欄位的排序跟原始 /filters 回應一致。
 *       前端可以用這支 API 動態組出 screener 的篩選條件 UI 跟欄位選擇 UI（field 格式為
 *       "<metricKey>.<fieldKey>"，直接對應 POST /screener 跟 POST/PATCH /screener/column-presets 需要的格式；
 *       "stock.price" 是唯一的例外——來自 twse/tpex，不在這份目錄裡，但一樣可以當 screener 的顯示欄位）。
 *
 *       每個 metric／field 都帶 `description`（這個數字的定義）跟 `source`（資料來源）——給前端在
 *       欄位標題或篩選條件卡片上加 info icon + tooltip 用。目前這兩個欄位還是 `null`（oingg-analysis-ts
 *       的 /filters 尚未開始提供），schema 先準備好，等上游補上就會自動透過同步流入，不需要再改一次。
 *     tags:
 *       - Screener
 *     responses:
 *       200:
 *         description: 分類 / 指標 / 欄位清單（含 description/source，目前多為 null）。伺服器剛啟動、還沒同步成功過時可能是空陣列。
 */
filterCatalogRouter.get("/", async (_req, res) => {
  const categories = await getFilterCatalog();
  res.json({ categories });
});
