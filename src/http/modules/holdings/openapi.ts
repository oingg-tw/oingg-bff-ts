import { z } from "zod";
import { errorResponse, registry } from "@/http/swagger/registry.js";
import { dateRangeQuerySchema } from "@/http/modules/holdings/route.js";

/**
 * **2026-10-05 契約變更**：持股從一張自己維護的表變成交易紀錄（`/transactions`）的唯讀投影。
 * `POST /holdings`、`PATCH /holdings/{id}`、`GET /holdings/{id}` 都已移除。
 */
const holdingSchema = z
  .object({
    symbol: z.string(),
    quantity: z.number().openapi({ description: "總股數，含自動入帳的配股與成本不明的股數。" }),
    costUnknownQuantity: z.number().openapi({ description: "其中成本不明的股數。平常是 0。" }),
    averageCost: z.string().nullable().openapi({
      description:
        "**成本已知那部分**的移動平均成本，含買進手續費。全部股數都成本不明時是 null（不是 \"0.0000\"——0 會被讀成免費取得）。",
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
    "要表達「我在開始記帳之前就有 1000 股」：記一筆日期最早的 BUY。",
    "",
    "### 配股自動入帳（2026-10-05 起）",
    "依除權息行事曆的 `stockDividendRatio`（每股配幾股），在**除權日**自動記一筆價格 0 的買進：股數＝除權日",
    "前一天收盤後的持股 × 比例，無條件捨去。**不需要也不應該再手動記配股**，否則會重複。",
    "不用 `stockDividend ÷ 10`：面額不一定是 10 元（5314 是 0.5 元）。行事曆資料從 2019 年起（2020 年中以後完整）。",
    "",
    "### 成本不明",
    "`costUnknownQuantity` 的股數照樣計入庫存，但不參與均價；賣出時**先賣成本不明的股數**，所以成本已知的",
    "那部分均價不會被拉低。",
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

registry.registerPath({
  method: "get",
  path: "/holdings/realized",
  summary: "指定區間的已實現損益（含已出清的代號）",
  description: [
    "回傳**賣出日**落在 `[from, to]`（兩端都含）的每一筆賣出所實現的損益，依代號加總。省略 `from`／`to` 就是全部期間。",
    "",
    "**成本基礎是整段重算的移動平均**，區間開始前的買進照樣計入成本——區間只用來挑賣出日，不會截斷重算。",
    "所以同一筆賣出不論用哪個區間查，算出的已實現損益都一樣。",
    "",
    "**已出清的代號也會出現**，這正是它跟 `GET /holdings` 分開的理由：`GET /holdings` 是「現在」的部位，",
    "這裡是一段**期間**的損益；放在同一列會讓今天的股數和去年的損益並排出現。",
    "",
    "只有區間內至少一筆賣出的代號才會列出。`totalRealizedProfitLoss` 是各列（已四捨五入）的加總，",
    "所以畫面上的列一定加得起來等於它。股利不計入。",
  ].join("\n"),
  tags: ["Holdings"],
  security: [{ bearerAuth: [] }],
  request: { query: dateRangeQuerySchema },
  responses: {
    200: {
      description: "區間內的已實現損益。",
      content: {
        "application/json": {
          schema: z
            .object({
              from: z.string().nullable(),
              to: z.string().nullable(),
              symbols: z.array(
                z.object({
                  symbol: z.string(),
                  realizedProfitLoss: z.string().openapi({ example: "12345.6700" }),
                  excludedSellCount: z.number().openapi({ description: "這一檔有幾筆賣出碰到成本不明的股數（那部分未計入損益）。" }),
                  excludedShares: z.number().openapi({ description: "這一檔被排除在損益之外的成本不明股數。" }),
                }),
              ),
              totalRealizedProfitLoss: z.string().openapi({ example: "389025.0000" }),
              excludedSellCount: z.number().openapi({ description: "全部合計。用來顯示「N 筆成本不明，未計入」。" }),
              excludedShares: z.number(),
            })
            .openapi("RealizedProfitLossReport"),
        },
      },
    },
    400: errorResponse("日期不是 YYYY-MM-DD、不是真實存在的日期，或 from 晚於 to。"),
    401: unauthorized,
  },
});

registry.registerPath({
  method: "get",
  path: "/holdings/performance",
  summary: "持股組合的期間報酬（時間加權，用來跟大盤比）",
  description: [
    "回傳持股組合在 `[from, to]` 的**時間加權報酬（TWR）**與逐日累積報酬。用 TWR 而不是資金加權，",
    "是因為要跟指數比就得排除「什麼時候投入多少錢」的影響。預設區間是**到今天（台灣時間）為止的一年**。",
    "",
    "### 交易日與對齊",
    "`series` 的日期就是加權指數的交易日，所以跟 `GET /market/taiex-daily-price` 逐日對得上。",
    "",
    "### 每日報酬的算法",
    "`r_t = (V_t − V_{t−1} − CF_t) ÷ (V_{t−1} + 當天流入)`，連乘成累積報酬。V 是收盤後的持股市值，",
    "CF 是淨流入（買進金額＋手續費 − 賣出淨收入）。**流入算開盤前投入、流出算收盤後**：分母包含當天",
    "投入的錢，所以前一天持股很小、當天大筆買進時單日報酬不會爆掉。代價是剛好以收盤價買進的那天會被",
    "新資金稍微稀釋。以前一天收盤價買進、當天收盤價賣出時是精確的：單一個股不論怎麼加減碼，",
    "TWR 都等於股價漲跌幅。",
    "",
    "### 不含息",
    "現金股利不計入，跟價格型的加權指數口徑一致。",
    "",
    "### 配股與成本不明",
    "**自動入帳的配股**流入是 0：除權當天股價下跌，新股的市值剛好補回來，所以除權本身不產生報酬。",
    "**成本不明的取得**當成以當天收盤價轉入的資金：它本身不產生報酬（若照價格 0 算，整筆市值會變成假的獲利）。",
    "",
    "### null 的意思",
    "`cumulative` 在**第一次有持股之前**是 null：期間中才開始投資的話，前面那段不畫成 0% 的水平線。",
    "整段期間都沒有持股時 `twr` 是 null，那不是「報酬 0」。",
    "",
    "### missingPrices",
    "有持股但當天沒有收盤價（沒成交、停牌、上游還沒更新）就沿用前一個收盤價；連一個都沒有就用最近一筆",
    "交易價。這些天數依代號列在這裡，請照實註明。",
    "",
    "### 期間上限",
    "個股收盤價最多回溯約 2000 個交易日（約 8 年）。期間超過時回 400，訊息會寫出最早可以從哪天開始——",
    "而不是用交易價估更早的市值，給出一個看起來正常的錯數字。",
  ].join("\n"),
  tags: ["Holdings"],
  security: [{ bearerAuth: [] }],
  request: { query: dateRangeQuerySchema },
  responses: {
    200: {
      description: "期間報酬。",
      content: {
        "application/json": {
          schema: z
            .object({
              from: z.string().openapi({ example: "2025-10-05" }),
              to: z.string().openapi({ example: "2026-10-05" }),
              twr: z.string().nullable().openapi({ description: "小數字串，6 位。\"0.123456\" = 12.3456%。", example: "0.123456" }),
              series: z.array(
                z.object({
                  date: z.string(),
                  cumulative: z.string().nullable().openapi({ example: "0.012345" }),
                }),
              ),
              missingPrices: z.array(z.object({ symbol: z.string(), dates: z.number() })),
            })
            .openapi("PortfolioPerformanceReport"),
        },
      },
    },
    400: errorResponse("日期格式錯誤、from 晚於 to，或期間超過收盤價能回溯的深度（約 8 年）。"),
    401: unauthorized,
  },
});
