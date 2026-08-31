# 修復跨服務直連 DB 反模式：遷移計畫

> 對應 [業務中台與後台資料邊界架構.md](./業務中台與後台資料邊界架構.md) 裡承認的取捨：bff-ts 目前直接查詢 oingg-twse-ts、oingg-tpex-ts、oingg-analysis-ts 的資料庫。這份文件規劃如何把這些直連換成正規的服務間 API 呼叫。**只規劃，不動碼**——需要跨三個服務協調，任何一個階段開始實作前都要先跟對應的 session 對齊 API 規格。

## 為什麼現在要修

見架構文件「為什麼跨服務直連 DB 在這裡是可接受的取捨」一節列出的條件：小規模、單人多 session、即時協調。這些條件本身沒有消失，但直連本身累積了實際成本：
- ROC 民國年欄位誤判成西元年的 bug——bff-ts 得自己搞懂 analysis-ts 資料表的內部慣例，這正是「領域知識外洩到中台」的具體例子。
- `toSnakeCase()` 需要手動維護 camelCase→snake_case 對應規則，且已經因為 `beta1Y` 這種邊界案例出過錯——這類轉換邏輯的權威應該在 analysis-ts，不是 bff-ts 猜測。
- bff-ts 的 screener.service.ts 現在超過 400 行都是動態組 SQL、CTE、JOIN 邏輯，這些其實是 analysis-ts 資料模型的知識，卻活在中台裡。

## 範圍界定：不是所有直連都要修

**不動**：filter catalog 的 sync 機制（已經是 API-based，見架構文件原則三）、`stock.price` 這種原則一裡「單純查一個欄位、無業務規則」的部分，只要新 API 蓋起來就是直接把查詢對象從 DB 換成 API，不改變「這是原始值查詢」的本質。

**要動的兩塊**：

| 現況 | 檔案 | 要換成 |
| :---- | :---- | :---- |
| 直查 twse/tpex 的 `daily_price`／`daily_valuation` | `src/domains/stock/stock.service.ts` | 呼叫 twse-ts／tpex-ts 各自新開的查詢 API |
| 直查 analysis-ts 的季報/日頻指標表（30+ 張表，動態 CTE/JOIN） | `src/domains/screener/screener.service.ts`、`analysisMetricTables.ts` | 呼叫 analysis-ts 新開的通用 screener 查詢 API |

## 階段一：twse-ts／tpex-ts 查詢 API（範圍小，風險低）

### 現況分析
`stock.service.ts` 只有三種查詢，分別對應 `daily_price`／`daily_valuation` 兩張表：

1. 單一股票最新股價：`SELECT "tradeDate", close FROM daily_price WHERE symbol=$1 ORDER BY "tradeDate" DESC LIMIT 1`
2. 單一股票最新估值：`SELECT "tradeDate","peRatio","pbRatio","dividendYield" FROM daily_valuation WHERE symbol=$1 ORDER BY "tradeDate" DESC LIMIT 1`
3. 批次多股票最新股價：`SELECT DISTINCT ON (symbol) symbol, close, "tradeDate" FROM daily_price WHERE symbol = ANY($1) ORDER BY symbol, "tradeDate" DESC`

一支股票只會存在其中一個市場（twse 或 tpex），bff-ts 目前是兩邊平行查、誰有資料用誰的。

### 需要 twse-ts／tpex-ts 各自新增的 API（規格草案，待雙方 session 確認）

```
GET /stocks/:symbol/quote
→ 200 { symbol, price: { tradeDate, close } | null, valuation: { tradeDate, peRatio, pbRatio, dividendYield } | null }
→ 404 該市場完全沒有這支股票的資料（bff-ts 再去問另一個市場）
```

```
GET /stocks/prices?symbols=2330,2317,...
→ 200 { prices: { [symbol]: { close, tradeDate } } }  // 只包含這個市場有資料的股票代號
```

**認證方式待確認**：twse-ts/tpex-ts 現有的所有 HTTP 路由都是 `requireTaskSecret` 保護的任務型端點，沒有「給其他服務查詢用」的公開讀取慣例。這兩支新 API 是否也套用同一套共用密鑰模式，還是設計成不需認證的內部唯讀端點，需要跟 twse-ts／tpex-ts 的 session 討論——這會影響 bff-ts 要不要另外管理兩把（或共用一把）task secret。

### bff-ts 這邊的改動
- 新增 `twseClient.ts`／`tpexClient.ts`（比照 `valuationRanking.client.ts`、`filterCatalog.client.ts` 現有的 client 模式：fetch + try/catch 轉 502 + response 格狀驗證）。
- `stock.service.ts` 的 `findLatestPrice`／`findLatestValuation`／`findLatestClosePricesInMarket` 改呼叫對應 client，移除 `queryNeon("twse"/"tpex", ...)`。
- `getStockQuote`／`getLatestClosePrices` 的對外簽章與回傳格式維持不變——這是這次遷移的關鍵約束：呼叫端（holdings/transactions/watchlist 驗證股票代號、screener 顯示股價欄位）完全不用改。
- 移除後，若沒有其他地方使用 `queryNeon("twse", ...)`／`queryNeon("tpex", ...)`，`pool.ts` 裡對應的 pool 註冊、`TWSE_DATABASE_URL`／`TPEX_DATABASE_URL` 環境變數可以整個拔除（比照這次拔除 `MOPS_DATABASE_URL` 的做法）。

### 驗收標準
- 現有 169 個測試裡，`stock.service.test.ts` 改成 mock client 而非 mock `queryNeon`，其餘測試（holdings/transactions/watchlist/screener）因為 `getStockQuote`／`getLatestClosePrices` 的介面沒變，理論上不用改。
- 對照真實資料：遷移前後對同一批股票代號跑 `getLatestClosePrices`，結果要逐筆比對一致（含 `asOfDate`）。

## 階段二：analysis-ts 通用 screener 查詢 API（範圍大，風險高）

### 現況分析
`screener.service.ts` 現在做的事：
1. 把 `field`（如 `"roe.roeTtmPct"`）解析成 `metricKey`/`fieldKey`，對照本地同步的 filterCatalog 拿到 `metricName`/`fieldName`。
2. 查 `ANALYSIS_METRIC_TABLES` 找出這個 metric 對應哪張表、用什麼欄位排序找「最新一筆」、要不要额外的 WHERE 條件（合併報表限定）。
3. 每個牽涉到的 metric 各自組一個 CTE（`DISTINCT ON (symbol) ... ORDER BY ... DESC`），依照「有門檻條件的 INNER JOIN、只是顯示欄位的 LEFT JOIN」規則兜起來。
4. 組出 WHERE 條件（範圍篩選／排除範圍）、分頁（`COUNT(*) OVER()`）、排序（ranking 用）。
5. 把結果的每個欄位包成 `{ value, asOfDate }`——季報類指標轉成 `"{yy}Q{season}"`（還要處理 ROC 民國年轉西元年），日頻類指標維持日期字串。

這整套邏輯的權威知識（哪個指標在哪張表、欄位怎麼轉換、`year` 欄位是民國年）全部屬於 analysis-ts，卻現在活在 bff-ts。

### 需要 analysis-ts 新增的 API（規格草案，待對方 session 確認且需要他們真的排入開發）

```
POST /screener
Body: {
  filters: [{ field: "roe.roeTtmPct", min: 15, max: null, exclude: false }, ...],
  columns: [{ field: "roe.roeTtmPct" }, ...],
  page: 1,
  pageSize: 50
}
→ 200 {
  count, page, pageSize, totalPages,
  columns: [{ field, metricName, fieldName }],
  results: [{ symbol, values: { [field]: { value, asOfDate } } }]
}
→ 400 field 不存在於 catalog，或 page/pageSize 不合法
→ 501 field 存在於 catalog 但還沒接上實際資料表（沿用 bff-ts 現有慣例，不是 crash）
```

```
GET /screener/ranking?field=roe.roeTtmPct&direction=desc&limit=10&columns=stock.price
→ 200 同 POST /screener 的 columns/results 形狀，不分頁
```

**這兩支的 URL/參數刻意跟 bff-ts 現有的 `POST /screener`、`GET /screener/ranking` 幾乎一樣**——這樣 bff-ts 的角色會非常單純：收到前端請求 → 呼叫 analysis-ts 對應端點 → （如果有要求 `stock.price`）呼叫階段一做好的 twse/tpex client 補上股價欄位 → 回傳。column preset 解析（使用者自訂顯示欄位）仍然留在 bff-ts，因為那是使用者偏好資料，屬於 bff-ts 自己的權限範圍。

**`per`/`pbr`/`dividendYield` 這三個欄位維持現狀**：它們已經是呼叫 analysis-ts 的 `GET /valuation/ranking`，不受這次遷移影響——這次要遷移的是「其他 30+ 個指標」現在還在直連的部分。如果 analysis-ts 想順便把新 screener API 也涵蓋這三個欄位、讓 bff-ts 統一呼叫一支端點，是可以討論的加分項，不是必要條件。

### bff-ts 這邊的改動
- 新增 `analysisScreenerClient.ts`。
- `runScreener`／`runRanking`（非 valuation-ranking 分支）改成組請求打這支新 API，移除 `buildMetricCtes`、`ANALYSIS_METRIC_TABLES`、`toSnakeCase`、`toQuarterLabel`、ROC 年份轉換邏輯——這些全部搬到 analysis-ts。
- `resolveCatalogFieldRefs` 對 filterCatalog 的查詢（本地同步的目錄）保留，因為那是「這個 field 存不存在、叫什麼名字」的查詢，跟 filter catalog 的 sync 機制（原則三）是同一件事，不受這次遷移影響。
- 移除後，若 analysis DB pool 完全沒人用（analysis-ts 自己的 DB 只給自己的服務查），`ANALYSIS_DATABASE_URL` 可以整個拔除。

### 這次遷移「順便」解決的問題
- ROC 民國年轉換邏輯回到 analysis-ts 自己手上——不會再有 bff-ts 猜錯欄位語意的風險。
- `toSnakeCase()` 的 camelCase→snake_case 猜測規則整個消失——analysis-ts 直接用自己知道的真實欄位名，不需要「猜」。
- bff-ts 的程式碼量大幅減少，`screener.service.ts` 從 400+ 行的動態 SQL 產生器變成一個薄的 API 轉接層。

### 風險與需要特別注意的地方
- **行為一致性是最大風險**：分頁邊界（`page`/`pageSize` 上限）、`exclude` 篩選的邊界條件（null 值處理）、`asOfDate` 的季度/日期格式、排序 tie-breaking，都要跟現在的行為逐一對照，任何細微差異都可能讓前端結果「看起來一樣但數字不一樣」而不易察覺。
- **analysis-ts 需要真的投入開發**，不是加一支端點那麼簡單——等於要把 bff-ts 這 400 行的動態查詢邏輯，用他們自己的 ORM/慣例重新做一遍，且要處理跟 bff-ts 現在一樣的 JOIN 策略（哪些指標可以互相搭配當篩選/顯示欄位）。這件事的時程不是 bff-ts 這邊能承諾的。
- **效能**：analysis-ts 那支新 API 需要撐住跟現在 bff-ts 直連時差不多的查詢效能與併發量，這在小規模下應該不是問題，但要跟他們一起用真實資料驗證過。

## 建議執行順序

1. 階段一（twse/tpex）先做——範圍小、影響面窄、能單獨驗證，也能先驗證「client 模式 + 502 錯誤處理」這套已經在 `valuationRanking.client.ts`／`filterCatalog.client.ts` 用過的模式一樣適用在這裡。
2. 階段一穩定之後，再跟 analysis-ts 談階段二——因為階段二需要對方投入較多開發時間，值得先用階段一的經驗（API 規格怎麼定、client 怎麼寫、測試怎麼改）當範本，讓 analysis-ts 那邊評估工作量更有依據。
3. 每個階段都是**乾淨切換，不做雙軌並行**：新 API 驗證過（含跟真實資料逐筆比對）就直接換掉直連程式碼，不留 feature flag 或 fallback 長期並存——這符合這個專案一直以來「驗證完就commit，不留半成品」的做法，雙軌並存只會增加要同時維護兩套邏輯的成本。

## 不在這次範圍內

- MOPS：本來就沒有直連，不用處理。
- filter catalog 的 sync 機制：已經是 API-based（原則三），不受影響。
- bff-ts 自己的 Prisma DB（`DATABASE_URL`，使用者資料/持股/交易/主題偏好等）：這是 bff-ts 自己擁有的資料，不是「後台」，不在這次反模式修復的討論範圍。

## 下一步

這份計畫需要使用者確認優先順序與時程後，才會找 oingg-twse-ts、oingg-tpex-ts、oingg-analysis-ts 的 session 對齊 API 規格——目前只是草案，還沒有跟任何一方討論過。
