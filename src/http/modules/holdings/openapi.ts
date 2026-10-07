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
        "剩下的**成本已知那幾批**的平均成本（總成本 ÷ 股數），含買進手續費。全部股數都成本不明時是 null（不是 \"0.0000\"——0 會被讀成免費取得）。",
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

const periodReturnSchema = z.object({
  period: z.string().openapi({ example: "2026-03" }),
  portfolio: z.string().openapi({ example: "0.034567" }),
  benchmark: z.string().openapi({ example: "0.051234" }),
  tradingDays: z.number(),
});

const unauthorized = errorResponse("缺少或無效的 Authorization header / token。");

registry.registerPath({
  method: "get",
  path: "/holdings",
  summary: "列出目前登入使用者的持股（由交易紀錄算出）",
  description: [
    "**這是唯讀投影，不是一張可寫的表（2026-10-05 起）。** 持股由 `/transactions` 的交易紀錄依交易日重跑算出，",
    "所以沒有 `id`、`note`、`createdAt`、`updatedAt`——那些是「那一列」的屬性，而那一列不存在了。",
    "",
    "成本法是**先進先出（FIFO，跟券商一致；2026-10-05 由移動平均改過來）**：每一筆買進、期初部位、自動配股（成本 0）、",
    "成本不明的取得各自是一批，賣出從最舊的一批開始扣。買進手續費計入那一批的成本；賣出的手續費與交易稅從價金扣掉。",
    "同一天的多筆交易依寫入順序（`createdAt`）重跑，因為 `tradeDate` 只有日精度。",
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
    "`costUnknownQuantity` 的股數照樣計入庫存，但不參與均價。它在 FIFO 裡是一般的一批，依日期決定何時被賣到；",
    "代表很久以前就有的股票時，請把它的日期設在那一檔最早交易之前，它就會最先被賣掉、成本已知那幾批不被碰到。",
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
    "**成本來自整段重算的批次（FIFO）**，區間開始前的買進照樣計入成本——區間只用來挑賣出日，不會截斷重算。",
    "所以同一筆賣出不論用哪個區間查，算出的已實現損益都一樣。",
    "",
    "**已出清的代號也會出現**，這正是它跟 `GET /holdings` 分開的理由：`GET /holdings` 是「現在」的部位，",
    "這裡是一段**期間**的損益；放在同一列會讓今天的股數和去年的損益並排出現。",
    "",
    "只有區間內至少一筆賣出的代號才會列出。`totalRealizedProfitLoss` 是各列（已四捨五入）的加總，",
    "所以畫面上的列一定加得起來等於它。股利不計入。",
    "",
    "`tradeStats`（2026-10-07）：區間內賣出的描述統計。勝率＝賺錢筆數 ÷（賺錢＋賠錢筆數）；平均賺／賠金額；獲利因子＝賺錢總額 ÷ |賠錢總額|（沒有賠錢的筆數時 null）；平均持有天數依股數加權（FIFO 批次的買進日到賣出日，配股那一批從除權日起算）。整筆成本不明的賣出不計勝負。只描述，不評等。",
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
              tradeStats: z.object({
                sellCount: z.number(),
                winCount: z.number(),
                lossCount: z.number(),
                winRate: z.string().nullable().openapi({ example: "0.583333" }),
                averageWin: z.string().nullable().openapi({ example: "18250.5000" }),
                averageLoss: z.string().nullable().openapi({ example: "-9120.0000" }),
                profitFactor: z.string().nullable().openapi({ example: "2.801234" }),
                averageHoldingDays: z.string().nullable().openapi({ example: "87.5" }),
              }),
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
    "",
    "### 2026-10-07 新增（只用實際帳本，不用回推）",
    "- `mwr`：資金加權報酬（IRR），換算成整段期間、跟 `twr` 同一個尺度。`twr` 是選股的報酬，`mwr` 是你的錢實際賺多少，差距就是進出場時機的影響。現金流口徑同 `twr`。",
    "- `annualized`：年化的 twr／mwr。**期間不滿 365 天時是 null**——把幾個月的報酬年化會把運氣放大。",
    "- `trading`：期間內買進、賣出金額，手續費、證交稅（元）。`turnover` ＝ min(買進, 賣出) ÷ 平均市值，`costRatio` ＝ (手續費＋證交稅) ÷ 平均市值，都是整段期間、不年化。成本不明的取得與配股不算交易。",
    "- `benchmarkComparison`：跟加權指數逐日比。上漲／下跌捕獲率＝大盤漲（跌）的那些天，組合的幾何平均日報酬 ÷ 大盤的幾何平均日報酬（Morningstar 定義；不是整段複利相比——大盤大漲的年度那會把比值壓得很低）；Omega（門檻 0）＝賺錢日報酬總和 ÷ 賠錢日報酬總和。`sampleDays` 少於 120 時三個值都是 null。",
    "- `riskAdjusted`：夏普、索提諾、卡瑪（年化 twr ÷ |實際最大跌幅|，期間不滿 365 天時 null）、M²（把組合風險調到跟大盤一樣時的年化報酬）、beta 與詹森 α（對大盤超額報酬回歸）、追蹤誤差、資訊比率。全部年化、只用實際績效；`sampleDays` 少於 120 或無風險利率取不到時全部 null。",
    "- `riskFree`：無風險利率用**五大銀行一年期定存**（使用者定案）。`rates` 逐月列出套用的年利率 %；`sourcePeriod` 跟 `period` 不同，代表那個月還沒有資料、沿用較早的月份（央行月報落後一到兩個月）。取不到時是 null，此時 `riskAdjusted` 全 null、其他欄位照常。",
    "",
    "- `periodReturns`：月報酬與年報酬表，組合對加權指數；同一列的兩個數字涵蓋同一批交易日，頭尾可能不是整月，看 `tradingDays`。",
    "- `drawdown`：實際組合的回撤期間統計（最大回撤與日期、在前高下方的交易日數、最長一段連續在前高下方的天數、期末距前高）。",
    "- `rolling`：滾動 60 個交易日的年化波動與 beta，畫趨勢線用。",
    "",
    "全部只描述統計，不含任何評等或建議。",
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
              mwr: z.string().nullable().openapi({ example: "0.098765" }),
              annualized: z.object({ twr: z.string().nullable(), mwr: z.string().nullable() }),
              trading: z.object({
                buyAmount: z.string().openapi({ example: "1250000" }),
                sellAmount: z.string(),
                fees: z.string(),
                taxes: z.string(),
                averageMarketValue: z.string().nullable(),
                turnover: z.string().nullable(),
                costRatio: z.string().nullable(),
              }),
              benchmarkComparison: z.object({
                sampleDays: z.number(),
                upCapture: z.string().nullable().openapi({ example: "0.912345" }),
                downCapture: z.string().nullable().openapi({ example: "0.701234" }),
                omega: z.string().nullable().openapi({ example: "1.234567" }),
              }),
              riskAdjusted: z.object({
                sampleDays: z.number(),
                sharpe: z.string().nullable().openapi({ example: "1.234567" }),
                sortino: z.string().nullable(),
                calmar: z.string().nullable(),
                m2: z.string().nullable(),
                beta: z.string().nullable(),
                jensenAlpha: z.string().nullable(),
                trackingError: z.string().nullable(),
                informationRatio: z.string().nullable(),
              }),
              riskFree: z
                .object({
                  source: z.literal("five-major-bank-1y-deposit"),
                  latestPeriod: z.string().nullable().openapi({ example: "2026-08" }),
                  rates: z.array(z.object({ period: z.string(), ratePct: z.number().openapi({ example: 1.7 }), sourcePeriod: z.string() })),
                })
                .nullable(),
              periodReturns: z.object({ monthly: z.array(periodReturnSchema), yearly: z.array(periodReturnSchema) }),
              drawdown: z
                .object({
                  maxDrawdown: z.string().openapi({ example: "-0.146574" }),
                  peakDate: z.string().nullable(),
                  troughDate: z.string().nullable(),
                  recoveryDate: z.string().nullable(),
                  underwaterDays: z.number(),
                  longestUnderwaterDays: z.number(),
                  currentDrawdown: z.string(),
                })
                .nullable(),
              rolling: z.object({
                windowDays: z.number(),
                series: z.array(z.object({ date: z.string(), volatility: z.string(), beta: z.string().nullable() })),
              }),
            })
            .openapi("PortfolioPerformanceReport"),
        },
      },
    },
    400: errorResponse("日期格式錯誤、from 晚於 to，或期間超過收盤價能回溯的深度（約 8 年）。"),
    401: unauthorized,
  },
});

const distributionRiskShape = {
  downsideDeviation: z.string().nullable().openapi({ example: "0.098765" }),
  ulcerIndex: z.string().nullable().openapi({ example: "0.045678" }),
  valueAtRisk95: z.string().nullable().openapi({ example: "-0.017890" }),
  expectedShortfall95: z.string().nullable().openapi({ example: "-0.025432" }),
};

const drawdownSchema = z.object({
  depth: z.string().openapi({ description: "最大跌幅（≤ 0 的小數）。期間內從來沒跌過時是 \"0.000000\"。", example: "-0.267102" }),
  peakDate: z.string().nullable(),
  troughDate: z.string().nullable(),
  recoveryDate: z.string().nullable().openapi({ description: "回到前高的那一天；期間結束時還沒回到就是 null。" }),
});

registry.registerPath({
  method: "get",
  path: "/holdings/risk",
  summary: "用現在的持股回推的風險指標（波動度、Beta、回撤、下行與尾端風險、集中度、風險貢獻）",
  description: [
    "拿**現在每一檔的市值比例**，當成整段期間每天都維持的比例，套用每一檔過去的日報酬，算出這組持股的風險。",
    "描述的是**現在手上這組**，不必等使用者自己累積持股歷史。預設期間是到今天為止的一年，最多回溯約 8 年（同 /holdings/performance）。",
    "",
    "### 刻意不提供報酬與夏普比率",
    "這組持股是事後選的，回推的報酬會偏高。真實的期間報酬請看 `GET /holdings/performance`。",
    "",
    "### 計算規則",
    "- 年化波動度 ＝ 日報酬標準差 × √252。Beta、相關係數以加權指數為基準。",
    "- **除權（配股）會還原**：除權當天股價依配股比例下跌不算虧損。**現金股利不還原**，跟價格型加權指數口徑一致。",
    "- 沒成交、停牌的日子沿用前一個收盤價。期間中才上市的持股，在有股價之前不參與，比例分給其他持股（見 `holdings[].coverage`）。",
    "- `tradingDays` 是實際用到的交易日數。統計誤差跟它有關：波動度約 3 個月可用，Beta 約 6 個月，請一起顯示。",
    "",
    "### 2026-10-07 新增",
    "- `downsideDeviation`：年化下行半標準差（只算跌的日子，門檻 0）。`ulcerIndex`：每天距前高跌幅的均方根，跌得深、泡得久都會變大。",
    "- `valueAtRisk95`／`expectedShortfall95`：單日 95% 歷史 VaR／CVaR（報酬，通常 ≤ 0），直接取實際日報酬，不假設常態；`tradingDays` 少於 100 時是 null。組合另有 `…Amount`：乘上現在市值 `marketValue` 的金額（元）。",
    "- `concentration`：只看現在權重。`effectiveHoldings` ＝ 1 ÷ HHI，「有 26 檔，實際上等於平均分散在幾檔」。",
    "- `diversificationRatio` ＝ Σ w_i σ_i ÷ σ_p（≥ 1）；`holdings[].riskContribution` ＝ 佔組合變異數的比例，加總約為 1。兩者在 `tradingDays` 少於 120 時是 null。",
    "- `sectors`：依現在權重的類股配置（查不到類股的歸在 sectorCode null 那組）與有效類股數。取不到時 null。",
    "- `fundamentals`：近 12 個月股利 × 現有股數（過去實際配發，不是預估）、組合殖利率、調和加權的本益比與股價淨值比；虧損公司沒有本益比，`…Coverage` 是有值那幾檔的市值佔比。取不到時 null。",
    "- `correlations`：兩兩日報酬相關係數矩陣（回推），symbols 依權重由大到小。少於 120 個交易日時 null。",
    "",
    "只描述統計，不含任何建議或風險等級。",
  ].join("\n"),
  tags: ["Holdings"],
  security: [{ bearerAuth: [] }],
  request: { query: dateRangeQuerySchema },
  responses: {
    200: {
      description: "風險指標。數值都是 6 位小數字串；沒有足夠資料時是 null。",
      content: {
        "application/json": {
          schema: z
            .object({
              from: z.string(),
              to: z.string(),
              tradingDays: z.number(),
              weightsAsOf: z.string().nullable().openapi({ description: "權重用的是哪一天的收盤價。" }),
              marketValue: z.string().nullable().openapi({ description: "現在持股總市值（元）。", example: "3250000" }),
              portfolio: z.object({
                annualizedVolatility: z.string().nullable().openapi({ example: "0.234567" }),
                beta: z.string().nullable().openapi({ example: "1.123456" }),
                correlation: z.string().nullable().openapi({ example: "0.812345" }),
                maxDrawdown: drawdownSchema,
                ...distributionRiskShape,
                valueAtRisk95Amount: z.string().nullable().openapi({ example: "-58000" }),
                expectedShortfall95Amount: z.string().nullable().openapi({ example: "-82000" }),
              }),
              benchmark: z.object({ annualizedVolatility: z.string().nullable(), maxDrawdown: drawdownSchema, ...distributionRiskShape }),
              concentration: z
                .object({ hhi: z.string(), effectiveHoldings: z.string().openapi({ example: "11.234567" }), topThreeWeight: z.string() })
                .nullable(),
              diversificationRatio: z.string().nullable().openapi({ example: "1.876543" }),
              holdings: z.array(
                z.object({
                  symbol: z.string(),
                  weight: z.string().nullable(),
                  coverage: z.enum(["full", "partial", "none"]),
                  firstPriceDate: z.string().nullable(),
                  riskContribution: z.string().nullable(),
                }),
              ),
              sectors: z
                .object({
                  effectiveSectors: z.string().nullable(),
                  groups: z.array(
                    z.object({ sectorCode: z.string().nullable(), sectorName: z.string().nullable(), weight: z.string(), symbols: z.array(z.string()) }),
                  ),
                })
                .nullable(),
              fundamentals: z
                .object({
                  dividendIncome: z.string().nullable().openapi({ example: "401000" }),
                  dividendYield: z.string().nullable().openapi({ example: "0.051600" }),
                  dividendCoverage: z.string(),
                  peRatio: z.string().nullable().openapi({ example: "15.234567" }),
                  peCoverage: z.string(),
                  pbRatio: z.string().nullable(),
                  pbCoverage: z.string(),
                })
                .nullable(),
              correlations: z.object({ symbols: z.array(z.string()), matrix: z.array(z.array(z.string().nullable())) }).nullable(),
            })
            .openapi("PortfolioRiskReport"),
        },
      },
    },
    400: errorResponse("日期格式錯誤、from 晚於 to，或期間超過收盤價能回溯的深度（約 8 年）。"),
    401: unauthorized,
  },
});

registry.registerPath({
  method: "get",
  path: "/holdings/stress",
  summary: "歷史壓力情境：現在的持股遇到過去幾次大跌會跌多少",
  description: [
    "用**現在的市值權重**回推過去幾段大跌（加權指數從高點到低點，日期是實際收盤找出來的）：2020 新冠疫情、2022 升息熊市、2024 日圓套利平倉、2025 關稅衝擊。",
    "問的是「這組持股遇到那樣的跌勢會跌多少」，不是預測，也不是你當時的組合。權重每天維持現在的比例（等於每天再平衡），跟「當時買進後放著不動」的結果不同。除權（配股）會還原，現金股利不還原。單一持股可能主導整段結果（例如某檔那段期間大漲數倍）。",
    "",
    "`coveredWeight`：當時就已經有股價的持股佔現在市值的比例；還沒上市的那幾檔不參與、比例分給其他持股，列在 `notCovered`，請照實註明。",
    "期間早於個股股價能回溯的深度（約 8 年）時 `available` 是 false、數值都是 null。只描述，不評等。",
  ].join("\n"),
  tags: ["Holdings"],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "每一段情境的回推結果。",
      content: {
        "application/json": {
          schema: z
            .object({
              weightsAsOf: z.string().nullable(),
              scenarios: z.array(
                z.object({
                  key: z.string().openapi({ example: "covid-2020" }),
                  name: z.string().openapi({ example: "2020 新冠疫情" }),
                  peakDate: z.string(),
                  troughDate: z.string(),
                  available: z.boolean(),
                  portfolio: z.object({ periodReturn: z.string().nullable().openapi({ example: "-0.214567" }), maxDrawdown: z.string().nullable() }),
                  benchmark: z.object({ periodReturn: z.string().nullable().openapi({ example: "-0.287235" }) }),
                  coveredWeight: z.string().nullable(),
                  notCovered: z.array(z.object({ symbol: z.string(), coverage: z.enum(["partial", "none"]), firstPriceDate: z.string().nullable() })),
                }),
              ),
            })
            .openapi("StressScenariosReport"),
        },
      },
    },
    401: unauthorized,
  },
});
