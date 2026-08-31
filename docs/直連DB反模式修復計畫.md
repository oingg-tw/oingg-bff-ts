# 修復跨服務直連反模式：遷移計畫

> 對應 [業務中台與後台資料邊界架構.md](./業務中台與後台資料邊界架構.md) 的鐵律：**業務中台（bff-ts）永遠不能主動存取後台（twse/tpex/mops/gov/sitca），不管是直連 DB 還是呼叫 API；唯一被允許存取的外部服務是 oingg-analysis-ts（數據中台），而且必須透過它的 API，連它自己的 DB 都不能直連。**
>
> 這是第二版計畫。第一版把 twse/tpex 的修復方向規劃成「twse-ts/tpex-ts 各自開查詢 API 給 bff 呼叫」——這個方向被推翻了：那本質上還是業務中台主動連去後台，只是把協定從 DB 換成 HTTP，沒有真的解決問題。正確方向是 **bff-ts 只跟 analysis-ts 講話，analysis-ts 負責鏡像 twse/tpex 的資料**。
>
> **只規劃，不動碼**——階段二需要 analysis-ts 真的投入開發，動工前要先跟對方 session 對齊規格。
>
> **更新（2026-08-31 稍晚）**：階段一的直連部分已經提前執行——使用者明確指示「現在馬上拔，接受這三個功能短期壞掉」，不等前置阻塞項解決。`stock.service.ts` 對 twse/tpex 的直連已移除，`getStockQuote()`／`GET /stocks/:symbol` 目前一律回 503（清楚說明原因，不是靜默失敗）；`getLatestClosePrices()` 優雅降級回傳空 map，screener/ranking 本身不受影響。下面「階段一」剩下的部分（analysis-ts 提供替代 API）還沒做，前置阻塞項也還沒解決。
>
> 另外，架構文件新增了**鐵律二**（數據中台不知道業務中台存在），這推翻了 filter catalog 原本規劃的「analysis-ts 主動通知」設計——那套機制已經拆除，改回 bff-ts 單向拉取。細節見 [業務中台與後台資料邊界架構.md](./業務中台與後台資料邊界架構.md)；這份文件只處理「直連 DB」問題，不重複討論同步方向。

## 目標架構

```
oingg-bff-ts（業務中台）
      │
      │  只能透過 API
      ▼
oingg-analysis-ts（數據中台）── 鏡像/彙整 ──▶ twse-ts / tpex-ts / mops-ts / gov-ts / sitca-ts（後台）
```

bff-ts 修復完成後，唯一還會直連的資料庫只剩自己的 `DATABASE_URL`（使用者資料：holdings/transactions/watchlist/theme 偏好/screener 與 column presets）。`TWSE_DATABASE_URL`／`TPEX_DATABASE_URL`／`ANALYSIS_DATABASE_URL` 全部從 `.env` 移除，比照 `MOPS_DATABASE_URL` 已經做過的清理。

## 現況

| 現況 | 檔案 | 狀態 |
| :---- | :---- | :---- |
| twse/tpex 的 `daily_price`／`daily_valuation` 直連 | `src/domains/stock/stock.service.ts` | **已移除**（2026-08-31）。替代 API 還沒做，功能暫時 503。 |
| 直查 analysis-ts 自己 DB 裡的 30+ 張指標表（動態 CTE/JOIN） | `src/domains/screener/screener.service.ts`、`analysisMetricTables.ts` | 尚未處理，繞過 analysis-ts 的服務邊界直連它的 DB |

## 前置阻塞項：analysis-ts 對 twse/tpex 的鏡像目前不完整

在規劃任何實作步驟之前，必須先確認一件事：**analysis-ts 現在有沒有能力回答「這支股票現在股價/估值是多少」這個問題？**

查證結果（2026-08-31）：analysis-ts 自己 DB 裡對應的表 `valuation_market_ratios` 只有 **1 筆資料**。這張表就是稍早這個 session 發現「排行榜不能直接用」的同一張表，問題到現在還沒解決。

這代表：**階段一不是「幫 bff 加一支 client」這麼簡單**，analysis-ts 必須先把 twse/tpex 的原始股價/估值資料完整鏡像進自己的 DB（或至少能即時彙整），bff-ts 才有辦法安全切斷對 twse/tpex 的直連。如果現在就切，會直接讓「查股票」「加自選股/持股/交易時驗證代號」這些功能大量退化（只有極少數股票查得到）。

**這是這份計畫裡最優先要跟 analysis-ts 對齊的問題，排在任何 API 規格討論之前。**

## 階段一：股票股價/估值查詢，改由 analysis-ts 提供

### bff-ts 現在的查詢（要保留的行為）
`stock.service.ts` 目前對 twse/tpex 做三種查詢，遷移後行為必須完全一致：
1. 單一股票最新股價 + 估值（`getStockQuote`）——`/stocks/:symbol`、新增持股/交易/自選股時驗證代號用。
2. 批次多股票最新股價（`getLatestClosePrices`）——screener/ranking 結果顯示 `stock.price` 欄位用。

一支股票只會存在上市或上櫃其中一個市場；目前 bff-ts 兩邊平行查、誰有資料用誰的。**這個「兩個市場合併」的邏輯，遷移後應該由 analysis-ts 負責**（它本來就該是彙整多個後台來源的角色），bff-ts 不需要再知道「上市/上櫃」這個概念存在。

### 需要 analysis-ts 新增的 API（規格草案，待對方 session 確認且需要他們先解決前置阻塞項）

```
GET /stocks/:symbol/quote
→ 200 { symbol, price: { tradeDate, close } | null, valuation: { tradeDate, peRatio, pbRatio, dividendYield } | null }
→ 404 完全查無此股票代號（不分上市/上櫃，analysis-ts 內部處理）
```

```
GET /stocks/prices?symbols=2330,2317,...
→ 200 { prices: { [symbol]: { close, tradeDate } } }
```

這兩支的形狀刻意跟 bff-ts 現有的 `getStockQuote`／`getLatestClosePrices` 回傳值一致，讓 bff-ts 這邊除了「查詢對象從 DB 換成 analysis-ts 的 client」以外，不需要改動任何呼叫端（holdings/transactions/watchlist/screener）。

### bff-ts 這邊的改動
- 新增 `analysisStockClient.ts`（比照 `valuationRanking.client.ts`、`filterCatalog.client.ts` 現有模式：fetch + try/catch 轉 502 + 回應格式驗證）。
- `stock.service.ts` 整個改成呼叫這支 client，移除 `queryNeon("twse"/"tpex", ...)`、`MARKETS` 常數、兩市場平行查詢邏輯。
- `getStockQuote`／`getLatestClosePrices` 對外簽章不變。
- 移除後，`TWSE_DATABASE_URL`／`TPEX_DATABASE_URL` 與對應的 pool 註冊可以整個拔除。

### 驗收標準
- 前置阻塞項解決後，對照遷移前後同一批股票代號的查詢結果，逐筆比對一致（含 `asOfDate`）。
- `stock.service.test.ts` 改成 mock client 而非 mock `queryNeon`；holdings/transactions/watchlist/screener 的測試因為介面沒變，理論上不用改。

## 階段二：screener/ranking 的財報比率查詢，改由 analysis-ts 提供 API（不再直連它的 DB）

### 現況分析
`screener.service.ts` 現在的邏輯（欄位解析、CTE/JOIN 動態組裝、分頁、`asOfDate` 格式化含 ROC 民國年轉換）全部是 analysis-ts 資料模型的知識，卻活在 bff-ts 裡——這是這次修復要解決的核心问题，不只是「protocol 從 DB 換 HTTP」而已，是把權威知識還給它該待的地方。

### 需要 analysis-ts 新增的 API（規格草案）

```
POST /screener
Body: { filters: [{ field, min, max, exclude }], columns: [{ field }], page, pageSize }
→ 200 { count, page, pageSize, totalPages, columns: [{ field, metricName, fieldName }], results: [{ symbol, values: { [field]: { value, asOfDate } } }] }
→ 400 / 501（field 不存在 / 還沒接上資料表，沿用 bff-ts 現有慣例）
```

```
GET /screener/ranking?field=...&direction=...&limit=...&columns=...
→ 同上形狀，不分頁
```

`per`／`pbr`／`dividendYield`（已經呼叫 `GET /valuation/ranking`）不受影響，維持現狀；階段二只處理其餘 30+ 個指標目前還在直連的部分。

### bff-ts 這邊的改動
- 新增 `analysisScreenerClient.ts`。
- `runScreener`／`runRanking`（非 valuation-ranking 分支）改成呼叫這支 API，移除 `buildMetricCtes`、`ANALYSIS_METRIC_TABLES`、`toSnakeCase`、`toQuarterLabel`、ROC 年份轉換邏輯——全部搬到 analysis-ts。
- `resolveCatalogFieldRefs` 對本地同步的 filterCatalog 查詢保留不變（屬於原則三，不受影響）。
- 移除後，`ANALYSIS_DATABASE_URL` 可以整個拔除——bff-ts 從此對 analysis-ts 只有 HTTP 依賴，沒有 DB 依賴。

### 這次遷移「順便」解決的問題
- ROC 民國年轉換邏輯回到 analysis-ts 自己手上，不會再有 bff-ts 猜錯欄位語意的風險（這正是新鐵律要解決的那種問題的具體案例）。
- `toSnakeCase()` 的 camelCase→snake_case 猜測規則整個消失。
- `screener.service.ts` 從 400+ 行的動態 SQL 產生器變成薄的 API 轉接層。

### 風險
- **行為一致性**：分頁邊界、`exclude` 篩選的 null 值處理、`asOfDate` 格式、排序 tie-breaking，都要逐一比對，細微差異不容易被發現。
- **開發量**：analysis-ts 要把 bff-ts 這 400 行的動態查詢邏輯用自己的方式重做一遍，時程不是 bff-ts 這邊能承諾的。

## 建議執行順序

1. **先解決前置阻塞項**：跟 analysis-ts 對齊「twse/tpex 資料鏡像完整性」的現況與修復時程——這件事不解決，後面的階段一動不了。
2. **階段一**：範圍相對小（兩支查詢 API），能獨立驗證，也能先確立「bff 只跟 analysis-ts 講話」這個 client 模式的範本。
3. **階段二**：等階段一穩定、且 analysis-ts 有餘力再談——範圍大、需要對方投入較多開發時間。
4. 每個階段都是**乾淨切換，不做雙軌並行**：新 API 驗證過（含跟真實資料逐筆比對）就直接換掉直連程式碼，不留 feature flag 或 fallback 長期並存。

## 不在這次範圍內

- filter catalog 的 sync 機制：已經完全符合新鐵律（只跟 analysis-ts 互動），不受影響。
- bff-ts 自己的 Prisma DB（`DATABASE_URL`）：這是 bff-ts 自己擁有的資料，不是「後台」或「數據中台」，不在這次修復範圍。
- mops-ts／gov-ts／sitca-ts：bff-ts 目前完全沒有存取，維持現狀；未來如果真的需要，必須由 analysis-ts 鏡像後提供，bff-ts 不能直接接觸。

## 下一步

先跟 oingg-analysis-ts 的 session 確認「twse/tpex 資料鏡像完整性」的現況與修復時程（前置阻塞項），確認後再開始討論階段一的 API 規格。目前完全還沒跟任何一方討論過。
