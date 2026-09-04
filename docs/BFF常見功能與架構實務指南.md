# BFF（Backend for Frontend）常見功能與架構實務指南

## TL;DR
- **BFF 是「一個前端體驗、一個專屬後端」的模式**：它不是要取代你的業務中台，而是坐在業務中台與各個前端（oingg.com Web、ifa.rocks、未來的行動 App）之間，替每一種客戶端做「資料聚合、裁剪、塑形」與「客戶端專屬的安全／工作階段處理」。核心原則是「保持 BFF 輕薄，不放領域業務邏輯」。
- **對你的架構而言，BFF ≠ 業務中台**：業務中台負責跨服務的「領域業務邏輯與可複用能力」（服務多個前台），BFF 負責「單一前端的展示層適配」（服務一個前台）。以你目前的兩微服務（數據中台 + 業務中台）規模，最務實的起手式是用 Next.js 的 Server Components / Route Handlers（或 tRPC）當作 Web 的 BFF，而不是馬上多開一個獨立微服務。
- **最該優先落地的 BFF 功能是「OAuth token 的伺服器端保管 + HttpOnly cookie 工作階段」**：這是 IETF 現行最佳實務明確建議的做法——IETF 於 2026 年 8 月將 `draft-ietf-oauth-browser-based-apps-26`（draft 本身標註 2025 年 12 月）發布為 **RFC 10017**（同時列為 BCP 212），能徹底避免把 access/refresh token 放在瀏覽器造成的 XSS 竊取風險。

## Key Findings

1. **BFF 的定義**：BFF 一詞由 SoundCloud 前工程師 Phil Calçado 提出（Sam Newman 原文致謝時明言「as (ex-SoundClouder) Phil Calçado called it a Backend For Frontend (BFF)」），並由 Sam Newman 於 2015-11-23 發表的部落格文章〈Backends For Frontends - A Microservice Pattern〉正式寫成模式。核心是「不要用一個通用 API 後端服務所有客戶端，而是替每一種使用者體驗做一個專屬後端」。
2. **它解決的問題**：通用 API 後端會變成瓶頸（所有前端的變更都擠在同一個部署物件）、逼出一個中央團隊、並產生 over-fetching（行動端只需要 8 個欄位卻拿到 40 個）與 chatty（一個畫面要打 5~10 支 API）。
3. **常見功能清單**（下方 Details 詳列）：向下游聚合／編排、資料塑形、認證與工作階段、快取、限流、協定轉換、錯誤正規化與降級、view-model 建構、分頁、即時資料代理、觀測性、安全邊界、i18n、feature flag。
4. **BFF ≠ API Gateway**：Gateway 是「所有客戶端的單一入口」，處理橫切關注（路由、SSL、認證、限流）；BFF 是「單一前端專屬」，處理聚合與塑形。二者常一起用：`Client → API Gateway → BFF → Microservices`。
5. **技術選型**：Node.js/TypeScript 是主流（前後端同語言、可共享型別）。常見有 Express、Fastify、NestJS、Hono、Next.js API routes/Server Actions、tRPC；GraphQL 派則用 Apollo Server / Federation。
6. **反模式**：肥 BFF（吞入業務邏輯變成分散式單體）、多個 BFF 間重複程式碼、業務邏輯從中台外洩到 BFF、fan-out 風暴、N+1。

## Details

### 1. 核心定義與目的
Sam Newman 在其模式文章中指出：一開始大家會先做「一個通用 API 後端」（general-purpose API backend），但行動裝置的體驗與桌面 Web 差異很大——螢幕小、要顯示的資料少、電量與流量有限、互動方式也不同。結果就是這個通用後端不斷長胖、變成瓶頸，並逼出一個專責團隊，讓前端團隊每次改動都要跨團隊協調。Newman 的解法是：**「一個使用者介面，一個伺服器端後端元件（BFF）」**，且 BFF 通常由該前端團隊自己維護，讓 API 能隨 UI 一起快速演進。

Newman 引用 Stewart Gleadow 的準則：**"one experience, one BFF"（一個體驗，一個 BFF）**。iOS 與 Android 體驗若很相似，可以共用一個行動 BFF；差異很大就拆開。他也強調 Pete Hodgson 的觀察：BFF 最好沿團隊邊界切分（Conway's Law）。

**歷史脈絡**：SoundCloud Backstage Blog 明載其「pioneered the Backends for Frontends (BFF) architectural pattern back in 2013」，當時是為了擺脫用單一 Public API 同時服務官方 App 與第三方整合的疲乏模型，在從 Rails 單體遷往微服務時發明。Netflix 也用此模式：其 TechBlog（Rohan Dhruva 與 Ed Ballot）描述 Android App 後端從單體換成獨立微服務時，「It looks like a very typical backend service in the Node.js world: a combination of Restify, a stack of HTTP middleware, and the Falcor-based API」，且「each client team owns their respective endpoints（各客戶端團隊擁有自己的端點/resolver）」。Netflix 工程師 Philip Fisher-Ogden 進一步說明其 BFF 層「runs on a platform called NodeQuark: an opinionated set of Node.js libraries and frameworks offered as a managed service by the Node.js platform team」，且「There are BFFs for the website, Android, iOS, TV, and a few other device platforms」。

### 2. BFF 常見功能／責任
- **向下游聚合與編排（Aggregation / Orchestration）**：一次 BFF 呼叫扇出多個下游微服務呼叫並組成單一回應。Newman 舉的 wishlist 例子：wishlist 服務、catalog 服務、inventory 服務三支呼叫，且應盡量並行（reactive/futures）以降低總延遲。
- **資料塑形／裁剪（Data Shaping）**：依客戶端需求回傳精簡或詳細資料。行動端只回 product id/name/price/thumbnail，桌面端回完整。
- **認證、授權與工作階段（最重要的安全功能）**：BFF 作為 OAuth confidential client，在伺服器端保管 access/refresh token，只發 HttpOnly、Secure、SameSite cookie 給瀏覽器。RFC 10017（前身 draft-ietf-oauth-browser-based-apps-26，作者 A. Parecki/Okta、P. De Ryck/Pragmatic Web Security、D. Waite/Ping Identity）在其 §6.1 明列 BFF 三大責任：(1)以 confidential client 身分與授權伺服器互動；(2)在 cookie-based session 脈絡下管理 access/refresh token、避免把任何 token 直接暴露給瀏覽器端應用；(3)把所有請求轉發至資源伺服器並附上正確的 access token。其安全效益是：即便攻擊者在瀏覽器內執行惡意程式碼，因為 token 只存在於 BFF，瀏覽器內沒有 token 可竊取，且 HttpOnly cookie 防止直接存取 session state。此外 RFC 9700（OAuth 2.0 Security Best Current Practice，2025-01，即 BCP 240）規定「Public clients MUST use PKCE」、「Authorization servers MUST support PKCE」，並以 SHOULD NOT 明確不建議使用 Implicit grant。Auth0、Curity（將此進化版稱為 Token Handler Pattern）、Duende、FusionAuth 都推此法。
- **請求／回應快取**：可在 BFF 前放 reverse proxy 快取聚合結果；需注意快取過期要取最短的那一份內容。可做 per-client 快取調校。
- **限流（Rate Limiting）**：SoundCloud 的 BFF 就處理限流、認證、header 清理、cache control。
- **協定轉換**：對前端用 REST/GraphQL/tRPC，對內部用 gRPC。pronextjs 範例用 Next.js + TwirpScript（gRPC）示範。
- **錯誤正規化與降級／熔斷**：把內部 HTTP 500 或 JSON 內錯誤統一成客戶端可理解的標準格式；當 inventory 服務掛掉時可只降級掉庫存指示、仍回傳部分結果。
- **view-model 建構、分頁**：Azure 範例中，行動 BFF 一次回一頁、桌面 BFF 一次回多頁。
- **即時資料代理**：BFF 可維持 WebSocket 長連線；AWS 提出事件驅動 BFF（各自有 UI 專屬的 projection database）做近即時更新。
- **觀測性／追蹤**：每一跳都要可追蹤，建議 OpenTelemetry + Jaeger/Zipkin。
- **安全邊界**：隱藏內部服務拓撲、CORS、輸入驗證、隱藏 API 金鑰（前端無法安全保存密鑰）。
- **i18n、feature flag**：可放客戶端專屬的 A/B test、feature flag 邏輯。

### 3. 常見架構模式
- **一 BFF per 客戶端型別 vs 共享 BFF**：Newman 偏好嚴格「每種客戶端一個 BFF」（REA 做法）；SoundCloud 則 iOS/Android 共用一個 listener BFF（但他們事後說若重來會考慮拆開）。
- **BFF vs API Gateway**：Gateway = 所有客戶端單一入口、橫切關注；BFF = 單一前端專屬、聚合塑形。常見組合 `Client → Gateway → BFF → Microservices`。Azure 範例用 API Management（處理授權、監控、快取、路由）+ 各客戶端 Azure Functions BFF。
- **BFF vs GraphQL / Federation**：Azure 指出若已用 GraphQL 且有前端專屬 resolver，BFF 可能非必要。GraphQL Federation（Apollo）把多個 subgraph 組成一個 supergraph，適合多團隊大組織；Netflix 從 Falcor 走向 Federated Supergraph。企業常混用：BFF 處理客戶端專屬（auth、壓縮、feature flag），Federation gateway 處理資料組合。

### 4. 技術選型（TypeScript/Node.js）
- Node.js 主流原因：前後端同語言、可共享 TypeScript 型別。
- 框架：Express（簡單）、Fastify（效能，~95k req/s）、NestJS（結構化、DI、~65k req/s，但下游延遲才是瓶頸）、Hono（edge）。
- Next.js：API routes / Route Handlers / Server Actions / Server Components 本身就是一種內建 BFF；React Server Components 讓伺服器端邏輯不進瀏覽器 bundle。
- tRPC：端到端型別安全、自動 batching、與 TanStack Query 整合；適合前後端緊耦合、快速交付。Server Actions 則是 Next 原生、輕量，可搭 Zod 驗證。有團隊在兩者間來回（Documenso 從 Server Actions 回到 tRPC）。
- GraphQL：Apollo Server / Federation。

### 5. 常見陷阱與反模式
- **肥 BFF（Fat BFF / 分散式單體）**：BFF 吞入定價、資格判斷、詐欺評分等領域規則就變成分散式單體。準則：領域規則屬於下游服務，BFF 只做聚合/轉換/翻譯。
- **多 BFF 間重複程式碼**：Newman 對跨服務重複較寬容（重複優於錯誤耦合）；但 SoundCloud、Decathlon 都警告重複的共享邏輯（如 auth）會隨時間漂移、各自為政。緩解：定期審視業務邏輯歸屬、ADR、monorepo 共享型別。
- **業務邏輯外洩**：前端團隊為了不等後端，把驗證規則寫進各自 BFF，日後規則改變時三端各改一次、可能不一致。
- **fan-out 風暴與 N+1**：把整個分頁集合在伺服器端一次收齊可能拖垮系統。
- **可用性下降**：BFF 依賴越多下游，其可用性分數越低。
- **額外延遲與運維成本**：多一跳、多一個部署物件的生命週期與安全需求。

### 6. BFF 如何嵌入你的「數據中台 + 業務中台」架構
你目前是：數據中台（oingg-twse-ts，擁有 curated 層，經 HTTP API 供業務中台存取）+ 業務中台（跨服務聚合業務邏輯）。中文技術圈常見的定位是：**業務中台 = 企業級能力複用平台（服務多個前台）；BFF = 服務單一前台的技術適配層**。兩者不在同一抽象層——中台偏應用架構，BFF 偏技術架構。BFF 通常坐在 API Gateway 與業務中台之間，做接口代理、聚合以及「與 DB 無關」的展示邏輯。

對你（獨立開發者、兩微服務、Neon Postgres、Cloud Run、Node 22、TS、Prisma）的具體建議見下。

## Recommendations

**階段一（現在，最小成本）**：先不要多開一個獨立 BFF 微服務。用 oingg.com 的 Next.js 前端內建的 Route Handlers / Server Components / Server Actions（或加 tRPC）當作 Web 的 BFF，直接呼叫業務中台的 HTTP API。優先落地兩件事：(1) 把 OAuth token 保管移到伺服器端、只發 HttpOnly cookie（依 RFC 10017 §6.1）；(2) 把「一個畫面要多支業務中台呼叫」聚合成一支 BFF 端點。

**階段二（觸發條件：出現第二種前端，如 ifa.rocks 或行動 App）**：依「一個體驗一個 BFF」拆分。若 ifa.rocks 與 oingg.com 體驗差異大，就各自一個 BFF；行動 App 另開一個精簡 payload 的 BFF。此時可考慮把 BFF 抽成獨立 Cloud Run 服務（Fastify 或 NestJS）。

**階段三（觸發條件：下游服務超過 5 個、或多前端重複邏輯明顯）**：在 BFF 前面加一層薄的 API Gateway 處理橫切關注（認證、限流、路由），BFF 保持輕薄。若跨多前端的資料組合變複雜，再評估 GraphQL Federation。

**紅線（會改變建議的門檻）**：一旦你發現 BFF 裡出現定價、選股評分、資格判斷等領域規則，立刻把它推回業務中台——這是「肥 BFF」的警訊。若多個 BFF 開始複製同一段資料處理，設一個 ADR/monorepo 共享型別機制。

## Caveats
- 部分「edge functions 正在取代 BFF」「2026 年 BFF 成為預設架構」等說法來自帶行銷性質的部落格，屬趨勢觀察而非定論，應謹慎看待。
- 對單一 Web 前端、下游服務少的情況，Newman 本人認為 BFF 未必划算——其他 UI 組合技巧可能就夠了。以你目前兩微服務規模，獨立 BFF 微服務可能過度設計。
- RFC 10017（BCP 212，共 49 頁；DOI 10.17487/RFC10017）與其 draft-26 的 token 保管建議主要針對瀏覽器安全；若你短期只有 server-rendered Next.js，部分風險已被框架天然降低。此外，RFC 9700 對 Implicit grant 的正式關鍵字是 SHOULD NOT（並非 MUST NOT）；絕對禁止（MUST NOT）的是 Resource Owner Password Credentials grant。