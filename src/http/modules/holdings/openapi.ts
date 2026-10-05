import { z } from "zod";
import { errorResponse, registry } from "@/http/swagger/registry.js";

/**
 * **2026-10-05 契約變更**：持股從一張自己維護的表變成交易紀錄（`/transactions`）的唯讀投影。
 * `POST /holdings`、`PATCH /holdings/{id}`、`GET /holdings/{id}` 都已移除。
 */
const holdingSchema = z
  .object({
    symbol: z.string(),
    quantity: z.number(),
    averageCost: z.string().openapi({
      description: "移動平均成本，含買進手續費。字串以保留 Decimal(18,4) 的精度。",
      example: "550.5000",
    }),
    totalCost: z.string().openapi({ description: "quantity × averageCost，這個部位目前的總投入成本。", example: "550500.0000" }),
    realizedProfitLoss: z.string().openapi({
      description:
        "這個代號到目前為止的已實現損益（賣出價金 − 賣出手續費 − 交易稅 − 賣出股數 × 當時均價），可為負數。",
      example: "-1230.0000",
    }),
  })
  .openapi("Holding");

const unauthorized = errorResponse("缺少或無效的 Authorization header / token。");

registry.registerPath({
  method: "get",
  path: "/holdings",
  summary: "列出目前登入使用者的持股（由交易紀錄算出）",
  description: [
    "**這是唯讀投影，不是一張可寫的表（2026-10-05 起）。** 持股由 `/transactions` 的交易紀錄依交易日重跑算出，",
    "所以沒有 `id`、`note`、`createdAt`、`updatedAt`——那些是「那一列」的屬性，而那一列不存在了。",
    "",
    "成本法是**移動平均**：買進手續費計入成本；賣出的手續費與交易稅只進已實現損益、不動剩餘均價。",
    "同一天的多筆交易依寫入順序（`createdAt`）重跑，因為 `tradeDate` 只有日精度，而移動平均法下",
    "「先買後賣」與「先賣後買」會算出不同的均價。",
    "",
    "**股數為 0 的代號不會出現**（已出清就不是持股），所以它那段已實現損益在這裡也看不到。",
    "",
    "要表達「我在開始記帳之前就有 1000 股」：記一筆日期最早的 BUY。要表達配股／分割：記一筆 `price: 0` 的 BUY。",
    "兩者都不需要特別的欄位或旗標。",
  ].join("\n"),
  tags: ["Holdings"],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "持股清單，依 symbol 升冪排序。",
      content: { "application/json": { schema: z.object({ holdings: z.array(holdingSchema) }) } },
    },
    401: unauthorized,
  },
});

registry.registerPath({
  method: "delete",
  path: "/holdings/{symbol}",
  summary: "刪除一檔持股（＝刪掉這個代號底下所有交易）",
  description: [
    "持股是算出來的，所以「刪掉一檔持股」只能是**刪掉這個代號底下所有的交易紀錄**，不可復原。",
    "要刪單獨一筆交易請用 `DELETE /transactions/{id}`。",
    "",
    "**路徑參數 2026-10-05 由 `{id}` 改成 `{symbol}`**：投影沒有 id，這個資源的鍵本來就是代號",
    "（舊表的 unique constraint 也是 (firebaseUid, symbol)）。",
  ].join("\n"),
  tags: ["Holdings"],
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ symbol: z.string().openapi({ example: "2330" }) }) },
  responses: {
    204: { description: "刪除成功，無回應內容。" },
    400: errorResponse("symbol 為空。"),
    401: unauthorized,
    404: errorResponse("你在這個代號底下沒有任何交易紀錄。"),
  },
});
