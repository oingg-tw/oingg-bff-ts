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
 *       "<metricKey>.<fieldKey>"，直接對應 POST /screener 跟 PUT /screener/columns 需要的格式）。
 *     tags:
 *       - Screener
 *     responses:
 *       200:
 *         description: 分類 / 指標 / 欄位清單。伺服器剛啟動、還沒同步成功過時可能是空陣列。
 */
filterCatalogRouter.get("/", async (_req, res) => {
  const categories = await getFilterCatalog();
  res.json({ categories });
});
