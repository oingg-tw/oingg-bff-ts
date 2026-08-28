# 資安測試報告 — localhost:4000 (oingg-bff-ts)

- **測試日期**：2026-08-28
- **測試目標**：`http://localhost:4000`，實際跑的程式是 `C:\Users\Chuia\Documents\oingg-bff-ts`（PID 由 `netstat -ano` + `Get-CimInstance Win32_Process` 確認，cmdline 指向這個目錄的 `src/index.ts`）
- **資料環境**：使用者確認為純本地測試用的 Neon Postgres / Firebase，非 staging 或 production，因此本輪測試涵蓋了會寫入資料的操作與認證繞過嘗試
- **測試方式**：先讀原始碼建立攻擊面地圖，再對運行中的伺服器發送探測/攻擊性請求做實測驗證（不是只看程式碼就下結論）
- **範圍**：`/`、`/system/health`、`/auth/me`、`/users/me`、`/stocks/:symbol`、`/watchlist*`、`/screener*`、`/filters`、`/api-docs`

> ⚠️ **更正說明**：本專案先前有一份針對 `localhost:4000` 的報告其實測錯目標——當時打到的是 `oingg-auditor-ts`（一個 port 根本還沒指派的 skeleton 專案，湊巧當時也綁在 4000）。那份報告已刪除。這是本次唯一有效的報告，測試對象已用上述方式（PID/cmdline）明確核實過。

---

## 發現一覽（依嚴重度）

| # | 嚴重度 | 標題 | 狀態 |
|---|--------|------|------|
| 1 | 🔴 高 | 完全沒有安全標頭（未使用 helmet 或任何等效機制） | 待修復 |
| 2 | 🟡 中 | CORS 在「實際回應」上沒有加 `Access-Control-Allow-Origin`，只有 preflight 有——瀏覽器端會擋下合法的跨源請求 | 待修復（疑似框架層 bug） |
| 3 | 🟡 中 | 錯誤處理不分環境，把底層函式庫的錯誤訊息（`details`）原樣回傳給任何呼叫者 | 待修復 |
| 4 | 🔵 低 | 認證端點（`requireAuth` 呼叫 Firebase `verifyIdToken`）沒有 rate limit | 待評估 |
| 5 | ℹ️ 平台觀察 | `ultimate-express` 對「會動態修改實際回應」的 Express middleware 相容性有問題——已在**兩個**姊妹專案觀察到同一種症狀 | 建議獨立調查 |

---

## 1. 🔴 完全沒有安全標頭

**位置**：[src/app.ts](src/app.ts) — 整個檔案沒有 `helmet()` 或任何等效 middleware，只有 `cors()` 和 `express.json()`。

**實測**：
```
curl -sD - http://localhost:4000/ -o /dev/null

HTTP/1.1 200 OK
x-powered-by: UltimateExpress
content-type: application/json; charset=utf-8
...
```
沒有 `X-Content-Type-Options`、`X-Frame-Options`、`Strict-Transport-Security`、`Content-Security-Policy`、`Cross-Origin-Opener-Policy` 等任何一個。`x-powered-by: UltimateExpress` 直接洩漏框架指紋。

**影響**：這個 BFF 目前所有回應都是 JSON API，被瀏覽器直接渲染成 HTML 的風險較低，但仍缺乏 clickjacking（`X-Frame-Options`）、MIME-sniffing（`X-Content-Type-Options`）、傳輸安全強制（HSTS）等基本防護，且框架指紋外洩方便攻擊者針對性尋找已知漏洞。

**修復步驟**：
1. `pnpm add helmet`（`oingg-auditor-ts` 專案已經在用同一版本 `helmet@8.3.0`，可以直接對齊）。
2. 在 [src/app.ts](src/app.ts) 的 `app.use(cors(...))` 之前加 `app.use(helmet())`。
3. **加完之後務必實測**，不要只看程式碼確認——見下方發現 #5，這個框架有「middleware 設定的 header 沒有反映到實際回應」的已知症狀模式，加完後要重新跑一次 `curl -sD - http://localhost:4000/ -o /dev/null` 確認標頭真的出現。

---

## 2. 🟡 CORS 只有 preflight 正確，實際回應缺少 `Access-Control-Allow-Origin`

**位置**：[src/app.ts:15](src/app.ts#L15) — `app.use(cors({ origin: env.corsOrigins }))`，設定本身沒問題（[src/shared/env.ts:12](src/shared/env.ts#L12) 預設只允許 `http://localhost:3000`，白名單機制是對的）。

**實測**：
```
# Preflight OPTIONS，帶合法 Origin -> 正確帶回 Access-Control-Allow-Origin
curl -sD - -X OPTIONS -H "Origin: http://localhost:3000" -H "Access-Control-Request-Method: GET" http://localhost:4000/watchlist -o /dev/null
  access-control-allow-origin: http://localhost:3000   <- 有

# 實際的 GET，帶同一個合法 Origin -> 完全沒有 Access-Control-Allow-Origin
curl -sD - -H "Origin: http://localhost:3000" http://localhost:4000/ -o /dev/null
  (無 access-control-* 標頭)
```

**影響**：這不是「開太鬆」的資安漏洞（方向是失敗關閉，不是失敗開放），但代表**前端從 `localhost:3000` 實際呼叫這個 BFF 目前很可能會被瀏覽器的 CORS 機制擋下**——preflight 說可以，但真正的 GET/POST 回應少了header，瀏覽器 JS 讀不到回應內容。如果前端串接時遇到「network tab 看起來 200 但 fetch 丟 CORS error」，這就是原因，不用再花時間懷疑是不是 origin 設定錯了。

**根因推測**：跟發現 #5 是同一類問題——`ultimate-express` 對 preflight（它自己特別處理的 OPTIONS 路徑）以外的「實際請求」，似乎沒有正確套用 `cors()` middleware 設定的 response header。

**修復步驟**：
1. 先用上面的 curl 指令重現，確認不是本機環境問題。
2. 到 `ultimate-express` 的 repo 搜尋是否已有相同回報的 issue；若無，附上這個最小重現（OPTIONS 正常、GET 缺 header）回報。
3. 短期 workaround：可以試著手動在 routes 裡對每個回應加一個顯式設定 `Access-Control-Allow-Origin` 的 middleware，或評估換回標準 `express` 是否能解決（此專案已經有實際 domain 邏輯，換框架成本比 `oingg-auditor-ts` 高，需要評估）。

---

## 3. 🟡 錯誤處理把底層函式庫錯誤訊息原樣回傳

**位置**：[src/shared/errorHandler.ts:22-35](src/shared/errorHandler.ts#L22-L35)，實際觸發點在 [src/domains/auth/auth.middleware.ts:25](src/domains/auth/auth.middleware.ts#L25)：
```ts
next(new AppError("Invalid or expired authentication token", 401, error instanceof Error ? error.message : undefined));
```
`errorHandler` 把 `err.details` 不分環境原樣塞進回應：
```ts
res.status(err.statusCode).json({ error: { message: err.message, details: err.details } });
```

**實測**：
```
curl -H "Authorization: Bearer not-a-real-jwt" http://localhost:4000/auth/me

{"error":{"message":"Invalid or expired authentication token","details":"Decoding Firebase ID token failed. Make sure you passed the entire string JWT which represents an ID token. See https://firebase.google.com/docs/auth/admin/verify-id-tokens for details on how to retrieve an ID token."}}
```
帶一個看起來像 JWT 但少了 `kid` claim 的偽造 token，會換到不同的 `details` 文字（"Firebase ID token has no "kid" claim..."）。這代表 `details` 欄位會隨著攻擊者送的 token 長什麼樣子而變化，等於給了攻擊者一個 oracle，可以用來摸索 Firebase Admin SDK 內部驗證邏輯的分支（雖然目前測到的訊息本身是 Firebase 官方文件裡的公開說明，還不算高度敏感，但這個「不分環境洩漏內部錯誤細節」的模式本身是問題——換成別的地方丟出的 `Error`，`details` 可能就會變成 DB 連線字串片段、檔案路徑等更敏感的內容）。

**修復步驟**：
1. 在 `errorHandler.ts` 依 `env.isProduction` 決定要不要輸出 `details`：production 時一律省略，只在非 production 時附上，方便本機除錯。
2. 這個改動很小，建議跟發現 #1 一起處理，作為在繼續加新 domain 之前先補的地基問題。

---

## 4. 🔵 認證端點沒有 rate limit（低優先）

`requireAuth`（[src/domains/auth/auth.middleware.ts](src/domains/auth/auth.middleware.ts)）每次都會呼叫 Firebase `verifyIdToken`，服務本身沒有任何 IP/使用者層級的 rate limit。Firebase 自己對 token 驗證有其後端限制，且偽造/暴力破解 Firebase ID token 在密碼學上不可行，所以這不是立即可利用的漏洞，但完全沒有 rate limit 代表這支服務對任何形式的高頻請求（不管是不是針對 auth）都沒有防護。**現階段不需要處理**，但如果之後要對外開放（不是只給自家前端用），建議加上。

---

## 5. ℹ️ 平台觀察：`ultimate-express` 對「動態修改實際回應」的 middleware 相容性有問題

這不是這個專案自己的 bug，而是姊妹專案共用的 `ultimate-express@2.2.1` 框架本身的行為模式，記錄下來是因為它會讓「程式碼已經正確設定」跟「線上實際生效」出現落差，之後排查類似問題時可以直接對照：

| 症狀 | 專案 | 證據 |
|---|---|---|
| `helmet()` 設定的 response header 完全沒出現在實際回應 | `oingg-auditor-ts` | 見該專案先前的測試記錄 |
| `cors()` 的 `Access-Control-Allow-Origin` 只在 preflight OPTIONS 出現，實際 GET/POST 回應沒有 | `oingg-bff-ts`（本報告發現 #2） | 上方 curl 對照 |
| `swagger-ui-express` 的 `.setup(spec)` 沒有把自訂 spec 注入進 `swagger-initializer.js`，`/api-docs/swagger-initializer.js` 回傳的還是預設的 `https://petstore.swagger.io/v2/swagger.json` 佔位內容 | `oingg-bff-ts` | `curl http://localhost:4000/api-docs/swagger-initializer.js` |

三個症狀的共同點：都是「middleware 需要在請求處理過程中動態產生/修改回應」（設 header、依 setup 參數動態產生 JS），而**靜態檔案服務、路由匹配、preflight OPTIONS 這些 uWebSockets.js 原生處理的路徑則正常**。

**建議**：這值得開一個獨立的調查/回報任務，而不是每個專案各自繞過一次。步驟：
1. 寫一個最小重現專案，同時跑 `express` 和 `ultimate-express`，掛同一份 `helmet()` + `cors()`，比對兩者的實際 response header。
2. 確認是 `ultimate-express` 的已知限制還是版本 bug 後，回報 upstream issue（先搜尋 `ultimate-express` 的 GitHub issues 有沒有人已經回報過）。
3. 在 upstream 修好之前，`oingg` 系列所有用到 `ultimate-express` 的專案，凡是依賴 middleware 動態設 header 的地方都要各自加 workaround（手動設 header）或考慮換回標準 `express`。

---

## 已測試並排除的攻擊面（避免未來重複測試）

| 測試項目 | 方法 | 結果 |
|---|---|---|
| `/stocks/:symbol` SQL injection | 送 `2330' OR '1'='1` 等字元到公開、無需認證的端點 | 安全——[stock.service.ts](src/domains/stock/stock.service.ts) 全部用 `$1` 參數化查詢，沒有字串拼接 |
| Screener 動態 SQL（CTE 用 metricKey/column 直接內插進 SQL 字串，看起來最像有洞的地方） | 讀 [screener.service.ts](src/domains/screener/screener.service.ts) 全部邏輯 | 安全，但是**多層防禦疊起來才安全**，不是單一機制：`field` 先過 `findFilterField()`（DB 查表，metricKey/fieldKey 必須真實存在於 filterCatalog）→ `metricKey` 還要真的是 [analysisMetricTables.ts](src/domains/screener/analysisMetricTables.ts) 裡寫死的 ~23 個 key 之一才會通過 `ANALYSIS_METRIC_TABLES[metricKey]` 檢查 → 衍生出的 `column` 還要通過 `SAFE_IDENTIFIER = /^[a-z][a-z0-9_]*$/` regex。三關都過才會被組進 SQL 字串，數值（min/max）本身仍是走 `$n::numeric` 參數化。**這段邏輯複雜、以後改動時要小心別破壞其中一關**，但目前是安全的 |
| filterCatalog 是否有未授權的寫入端點 | 讀 [filterCatalog.routes.ts](src/domains/filterCatalog/filterCatalog.routes.ts) | 只掛了 `GET /`，唯一的寫入路徑 `replaceFilterCatalog()` 只被伺服器啟動時的內部同步流程呼叫，沒有對外的 HTTP 路由，不可從外部觸發 |
| Watchlist IDOR（能否用自己的 token 存取別人的自選股項目） | 讀 [watchlist.repository.ts](src/domains/watchlist/watchlist.repository.ts) | 安全——`findFirst`/`updateMany`/`deleteMany` 全部都用 `{ firebaseUid, id }` 一起當 where 條件，用 Prisma 參數化，無法只靠猜 `id` 存取別人資料 |
| JWT alg=none 偽造 | 自製 `{"alg":"none"}` 的假 token 打 `/auth/me` | 正確被拒絕（Firebase Admin SDK 驗證，非本專案自己實作 JWT 驗證，值得信任） |
| 未認證存取受保護端點 | 不帶 Authorization 打 `/watchlist`、`/users/me`、`/auth/me`、`/screener` | 全部正確回 401 |
| 超大 JSON payload（3MB） | POST 到 `/screener` | 快速被拒絕（500），無 hang、無洩漏，非 DoS 向量 |

---

## 後續待辦（優先順序）

1. **#1 + #3 一起修**：加 `helmet()`、修 `errorHandler` 依環境隱藏 `details`——這兩個改動小，建議近期就做。
2. **#5 平台調查**：獨立立案調查 `ultimate-express` 的 middleware 相容性問題，這會同時修好 #1（如果加了 helmet 也遇到同樣問題）跟 #2（CORS）。
3. **#2 CORS**：等 #5 查清楚根因後一併處理，或先套用手動設 header 的 workaround。
4. **#4 rate limit**：等服務要對外（非僅自家前端）使用時再處理。
5. `screener.service.ts` 的三層防禦（filterCatalog 查表 + 白名單 + regex）目前安全，但複雜、耦合度高——之後改動 screener 邏輯時，任何一個環節被誤刪都可能重新打開注入面，建議之後幫這段邏輯補上針對「惡意 field 值」的單元測試（例如 `field: "constructor.toString"`、`field` 帶 SQL 關鍵字等），把現在靠人工驗證過的安全性用測試固定下來。
