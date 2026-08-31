import { Router } from "ultimate-express";
import { requireTaskSecret } from "../../shared/requireTaskSecret.js";
import { getFilterCatalog, syncFilterCatalog } from "./filterCatalog.service.js";

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

/**
 * @swagger
 * /filters/sync:
 *   post:
 *     summary: 立即從 oingg-analysis-ts 重新同步 filter catalog（server-to-server，不給前端用）
 *     description: >
 *       這個服務原本只在啟動時同步一次 filter catalog，之後不會自動再抓。oingg-analysis-ts 更新自己的
 *       `/filters`（新增指標、補上 description/source 等）後，呼叫這支立即觸發重新同步，不用等我們重啟。
 *       這是一個「通知」端點，不是資料推送——實際資料還是這個服務自己向 oingg-analysis-ts 的 `/filters`
 *       重新拉一次（single source of truth 不變），呼叫方只需要送出通知、不需要附上目錄內容。
 *       用共用密鑰驗證，不是給前端呼叫的公開 API（見 x-task-secret header）。
 *     tags:
 *       - Screener
 *     parameters:
 *       - in: header
 *         name: x-task-secret
 *         required: true
 *         schema:
 *           type: string
 *         description: 也可以用 ?task_secret= query param 代替。
 *     responses:
 *       200:
 *         description: 同步完成，回傳這次抓到的分類數／指標數。
 *       401:
 *         description: 缺少或錯誤的 task secret。
 *       500:
 *         description: 伺服器沒有設定 TASK_SECRET（設定錯誤，不是呼叫方的問題），或向 oingg-analysis-ts 拉取失敗。
 */
filterCatalogRouter.post("/sync", requireTaskSecret, async (_req, res) => {
  const summary = await syncFilterCatalog();
  res.json(summary);
});
