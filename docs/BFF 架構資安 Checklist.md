# BFF 架構資安 Checklist（Node.js / TypeScript × Cloud Run × Neon Postgres 金融科技場景）

## TL;DR
- **BFF 的核心資安價值是「Token 永遠不進瀏覽器」**：以伺服器端 HttpOnly Session Cookie 取代前端儲存 OAuth token，把 XSS 竊 token 風險換成可控的 CSRF 風險——但 CSRF 防護、Session 撤銷、Cookie flags 全都變成你的責任，必須逐項落實。
- **最大的 BFF 專屬攻擊面是「內部信任外洩」與 SSRF**：BFF 會代呼叫多個內部微服務，若把外部 token 原封轉發、或讓使用者輸入決定下游 URL，就會造成 confused deputy 與 SSRF。必須做 audience 驗證、服務名稱 allowlist、egress 限制，並在 Cloud Run 上以 IAM + ingress internal-only 分層鎖定。
- **法遵定位要先分清**：作為未取得金融特許的獨立 SaaS，法律上直接拘束你的是《個人資料保護法》第 27 條「適當安全措施」與施行細則第 12 條 11 項；金管會的《金融資安行動方案 2.0》、《零信任參考指引》、5 年 log 保存等只拘束特許金融機構或當你成為銀行的第三方服務商（TSP）時才透過契約適用——但它們是最佳實務基準，建議自願對齊。

---

## Key Findings（關鍵判斷）
1. **BFF 是「機密客戶端（confidential client）」，這是它相對於瀏覽器公開客戶端的根本安全優勢**。依 IETF 的 `draft-ietf-oauth-browser-based-apps`（Parecki／De Ryck／Waite，2025 年 12 月送 IESG、擬定為 Best Current Practice），BFF 架構「is strongly recommended for business applications, sensitive applications, and applications that handle personal data」，且在此模式下「The only viable attack pattern is hijacking the client application in the user's browser」——正好對應本專案（金融個資 + 敏感應用）。
2. **BFF 不消除安全邊界，只是移動它**。Auth0〈Things Developers Get Wrong About the BFF Pattern〉逐字指出：「When you adopt BFF, you trade the token theft problem (XSS can steal tokens from browser storage) for the session management problem (your BFF now manages sessions and those need to be secured properly). This is a good trade in most cases, but it comes with responsibilities that BFF doesn't automatically fulfill.」
3. **對下游微服務，不要原封轉發前端 token**：正確做法是每一跳（hop）各自取得對應 audience 的 token 並驗證 `aud`，否則任一路由 bug 都可被放大成跨服務未授權存取（confused deputy）。
4. **Cloud Run 的預設是不安全的**：預設服務公開可存取，且若未指定 SA 會使用 Compute Engine 預設服務帳戶——依 Google Cloud〈Introduction to service identity〉，「the default service account might automatically be granted the Editor role on your project」，官方「strongly recommend that you disable the automatic role grant by enforcing the `iam.automaticIamGrantsForDefaultServiceAccounts` organization policy constraint」（2024/5/3 後新建的組織已預設強制此限制）。必須改為專屬最小權限 SA、內部服務設 ingress internal-only 並要求 IAM 驗證。
5. **秘密不要放環境變數明文**：Cloud Run 的環境變數會出現在 revision metadata，官方建議改用 Secret Manager，並特別警告「never set `GOOGLE_APPLICATION_CREDENTIALS` as an environment variable on a Cloud Run service; always configure a user-managed service account instead」。Neon 連線字串、API keys 應放 Secret Manager，並以掛載檔案（volume）方式支援輪替。
6. **Neon 連線必須 verify-full**：Neon 官方部落格〈Why Postgres needs better connection security defaults〉直言「sslmode=require offers barely any security at all. It's a bit like 'securing' your house by drawing the curtains but leaving the door on the latch.」——只用 `require` 幾乎不防 MITM，必須改 `verify-full`。（注意：node-postgres 目前把 `require` 當作 verify-full 處理，但 `pg` v9.0.0 將改採 libpq 語意、降級為僅加密不驗證，故務必明寫 `sslmode=verify-full`。）serverless 場景用 pooler endpoint，並確認連線字串（含密碼）不出現在前端 bundle。

---

## Details：分區塊 Checklist

### 一、身分驗證與 Session 管理（BFF 專屬）
- [ ] **採用 Session Cookie 模式，而非把 token 交給前端**：OAuth2/OIDC authorization code flow（含 PKCE）由 BFF 這個 confidential client 完成，access/refresh token 存在伺服器端 session store，前端只拿到 session cookie。
- [ ] **Session Cookie 三旗標齊全**：`HttpOnly`（阻擋 JS 讀取、防 XSS 竊 session）、`Secure`（僅 HTTPS 傳輸）、`SameSite=Strict` 或 `Lax`（防大部分 CSRF）。
- [ ] **使用 `__Host-` cookie 前綴**：把 cookie 綁定到確切 origin、強制 `Path=/` 與 `Secure`，防止子網域攻擊。
- [ ] **Session 採 server-side 儲存**：正式環境用 Redis 等持久化 store，不要用 in-memory（多實例不一致、重啟即失效）。Cloud Run 多實例與 scale-to-zero 特性使 in-memory session 不可行。
- [ ] **登出要 server-side 撤銷 session**，不只是清 client 端 cookie；並同步向 IdP 發起 end-session。
- [ ] **防 Session Fixation**：登入成功後重新產生 session id。
- [ ] **登出端點需 CSRF 防護**：否則攻擊者可用跨站 GET 摧毀他人 session（Duende 以 session id 當 query 參數作為此保護）。
- [ ] **危險操作（下單、資金相關、存取敏感財務資料）考慮加上 MFA / step-up authentication**。
- [ ] **短命 access token + refresh token 只留在 BFF**，前端完全不接觸。

### 二、CSRF 防護策略
- [ ] **雙重提交（double-submit cookie）或同步 token 模式**：狀態變更請求（POST/PUT/DELETE）需在 header 帶 CSRF token，後端驗證 header 與 cookie 相符。
- [ ] **要求自訂 header（如 `X-Requested-With` 或 `X-CSRF-Token`）**：此法會觸發 CORS preflight，跨站頁面無法補上該 header，是最簡潔的 CSRF 防線（Duende 建議）。
- [ ] **不要只依賴 SameSite**：SameSite 有幫助但 same-site 的 CSRF 仍可能發生，須搭配 token/header。
- [ ] **CSRF token 綁定 session**，讓第三方站無法偽造。

### 三、授權模式（Authorization）與避免內部信任外洩
- [ ] **每個物件存取都在伺服器端逐次檢查權限**（對抗 OWASP API1:2023 BOLA）：不要信任前端傳來的物件 id 就直接回資料。依 Salt Security，「BOLA vulnerabilities are present in around 40% of all API attacks and are listed as the number one threat to API security in the OWASP API Security Top 10.」
- [ ] **物件屬性層級授權**（API3:2023）：避免回傳使用者無權看的欄位（過度資料揭露 excessive data exposure）與 mass assignment。
- [ ] **功能層級授權**（API5:2023）：管理/內部功能要有明確角色檢查。
- [ ] **BFF 在 proxy 到下游前先完成授權判斷**，不要把授權責任推給下游而假設「內網即可信」。
- [ ] **不要原封轉發外部使用者 token 到內部服務**：改用 per-hop token（OAuth2 Token Exchange RFC 8693 / on-behalf-of）或 BFF 自身的服務身分，並讓每個內部 API 各自驗證 `aud`，拒絕 audience 不符的 token。
- [ ] **內部服務不得「因為在內網就接受未驗證呼叫」**：否則每個服務都成為 confused deputy。
- [ ] **最小 scope 原則**：轉發下游的 token 只給該次操作所需 scope、綁單一使用者、短效期。

### 四、BFF / API Gateway 專屬攻擊面
- [ ] **SSRF 防護（OWASP API7:2023）**：下游服務位址採**服務名稱 allowlist**，不接受使用者輸入的完整 URL 決定 proxy 目標。
- [ ] **封鎖私有網段與 metadata endpoint**：拒絕連向 RFC1918 私有位址、link-local `169.254.169.254`（雲端 metadata credentials）；即使 DNS 解析或直接 IP 也要擋（Stytch 做法：HTTP client 拒絕連向內部/保留 IP，並僅用公用 DNS resolver 防 DNS rebinding）。
- [ ] **URL 正規化後再驗證**：驗證「實際解析到哪」而非字串長相，防 `@` 憑證注入、替代 IP 編碼、redirect 繞過等 parser 不一致攻擊。
- [ ] **停用 HTTP redirect 自動跟隨**（或對 redirect 目標再次 allowlist 驗證）。
- [ ] **HTTP Request Smuggling 防護**：拒絕同時帶 `Content-Length` 與 `Transfer-Encoding` 的請求（回 400，Snyk 認為此為理想修法）；Node.js 已對此類做修補，須保持 Node 版本更新（Node 22 已修補早期 llhttp 相關 CVE，如 CVE-2023-30589 bare-CR、CVE-2021-22960 chunk 解析問題）。
- [ ] **儘量端到端使用 HTTP/2、避免 H2→H1.1 降級**，微服務鏈路中各層對 HTTP 語意須一致（CDN→LB→proxy→Node 若解析不一致即產生 desync）。
- [ ] **避免 over-fetching / under-fetching 造成資料揭露**：BFF 聚合多個下游回應時，只回前端「真正需要」的欄位，做 response shaping / 白名單欄位輸出。

### 五、BFF↔後端微服務的安全通訊（Cloud Run）
- [ ] **服務對服務用 OIDC identity token（IAM）**：呼叫端在 `Authorization` header 帶 metadata server 產生的 identity token，`aud` claim 需等於被呼叫服務 URL；被呼叫端授予呼叫端 SA `roles/run.invoker`（Node.js 用 `google-auth-library` 自動處理）。
- [ ] **每個服務用專屬 SA，勿共用、勿用 Compute Engine 預設 SA**（後者可能自動獲授 Editor 廣權，blast radius 過大）；建議強制 `iam.automaticIamGrantsForDefaultServiceAccounts` 組織政策。
- [ ] **內部微服務設 ingress = internal（僅 VPC / Internal ALB / VPC-SC 內）**，不對公網開放 run.app URL；ingress 設定與 IAM 驗證要「雙層」並用。
- [ ] **搭配 Direct VPC egress 或 VPC connector 做網路隔離**；注意 Cloud Run services/jobs 不支援 Direct VPC ingress。
- [ ] **VPC Service Controls 建立資料防外洩 perimeter**：run.app 與自訂網域皆受 VPC-SC 拘束，可防被竊 OAuth/SA 憑證從未授權網路存取；先用 dry-run 模式測試再 enforce。
- [ ] **所有內外部 API 通訊一律走 TLS**（OWASP API8 明確要求，即使內部也是）。mTLS / service mesh 可作進一步的服務身分驗證與 egress 政策強制（若日後導入 GKE/Istio）。
- [ ] **對前端仍要求 IAM/IAP 驗證的服務，正確處理 CORS preflight**：Cloud Run 建議用 IAP 並允許未驗證的 OPTIONS 請求以通過瀏覽器 preflight，但應用程式仍須自行回應正確 CORS header。

### 六、秘密管理（Secrets）
- [ ] **一律用 Secret Manager，不放 `--set-env-vars` 明文**：環境變數會出現在 CI/CD log、部署 manifest、Cloud Run revision metadata，任何有 `run.services.get` 權限者皆可讀。
- [ ] **切勿把 `GOOGLE_APPLICATION_CREDENTIALS` 設為 Cloud Run 環境變數**；一律改用 user-managed service account（官方明文警告）。
- [ ] **敏感值（Neon 連線字串、API keys、JWT 簽章金鑰）以 volume 掛載方式讀取**：掛載檔案在讀取時即時抓最新版本，較適合輪替；環境變數模式只在實例啟動時解析。
- [ ] **正式環境釘住 secret 版本（pin version）**，避免 `latest` 造成非預期變更；開發環境可用 latest。
- [ ] **Cloud Run 執行 SA 只授予 `roles/secretmanager.secretAccessor` 到「特定 secret」**，非專案層級。
- [ ] **絕不把 secret / `.env` / npm token bake 進 Docker image**；build-time token 用 BuildKit secret mount（`--mount=type=secret`）。
- [ ] **CI job 內清除部署秘密**；grep client bundle 確認沒有 `neon.tech` / `postgresql://` 外洩。
- [ ] **定期輪替憑證**；Neon 連線字串一旦外洩即等於全 DB 存取，須立即 reset password 並汰除舊 branch role。

### 七、輸入驗證與輸出編碼（防注入，金融資料查詢尤重）
- [ ] **一律用參數化查詢 / prepared statement**（`pg` 的 `$1` 佔位符），永不字串串接使用者輸入進 SQL。
- [ ] **用 Zod 做 schema 驗證**（TypeScript-first）：驗 body、query、route params 的型別、格式、範圍；即使用了參數化查詢仍要驗（縮小攻擊面、防非預期型別）。
- [ ] **排序/欄位名等無法參數化處理者，用 allowlist**（如 `orderBy` 只允許固定欄位集）。
- [ ] **ORM raw 逃生口要小心**（Prisma `$queryRaw`、`sequelize.query`），仍可能注入。
- [ ] **陣列長度上限、檔案上傳型別/大小限制**，防資源耗盡。
- [ ] **防 NoSQL injection（剝除 `$` 運算子）、prototype pollution、command injection、path traversal**。
- [ ] **輸出依情境編碼**：回 HTML 時做 HTML encoding，DB 用參數化。
- [ ] **資料庫使用最小權限帳號**（應用帳號勿給 DROP/DELETE 等非必要權限）。
- [ ] **多租戶資料表啟用 Row Level Security（RLS）** 或等效隔離，keyed on 請求的使用者身分。

### 八、CORS 設定
- [ ] **明確 origin allowlist，絕不用萬用字元 `*` 於帶認證的 API**。
- [ ] **絕不反射（reflect）未驗證的 `Origin` header**：這等同萬用字元，讓任何站點可帶 cookie 讀你的回應（Tesla of-CORS、Google IAP CORSLeak 等事件皆因此）。
- [ ] **`Access-Control-Allow-Credentials: true` 時只能配 specific origin**（瀏覽器禁止 `*` + credentials 組合）。
- [ ] **不要用寬鬆的 `*.example.com` regex**：任一子網域被接管即被利用。
- [ ] **CORS 只在一層設定**（BFF 或 nginx 擇一），避免重複 header 造成瀏覽器拒絕。
- [ ] **限制允許的 methods 與 headers，設定合理 `max-age` 快取 preflight**（如 600 秒）。
- [ ] **警惕 AI 生成的 `origin: true, credentials: true`**：這會讓 CSRF 防護失效，審查此類 diff——正確修法是把 dev origin 加進 allowlist，而非 `origin: true`。

### 九、Rate Limiting 與濫用防護
- [ ] **BFF 層做 per-user / per-API-key 限流**（對抗 OWASP API4:2023 Unrestricted Resource Consumption）。
- [ ] **選用 token bucket**（容許突發、user-facing API 一次頁面載入多請求的常態；AWS API Gateway、Stripe 皆採此）；分散式環境用 Redis 共享計數，避免多實例計數不同步。
- [ ] **成本加權限流**：搜尋/選股運算費資源者計較高成本，health check 計 0。
- [ ] **讀寫分開預算**；依方案分級（免費/付費/內部）不同限額。
- [ ] **超限回 HTTP 429 並附 retry 資訊**；記錄觸限者以偵測濫用。
- [ ] **敏感業務流程（如批量下載選股結果、爬取）加額外防護**（對抗 API6:2023 Unrestricted Access to Sensitive Business Flows）。
- [ ] **邊界層（如 Cloud Load Balancing + Cloud Armor）做粗粒度全域限流 / DDoS 防護**，應用層做細粒度。
- [ ] **正確設定伺服器 timeout**，丟棄 idle / 過慢請求（防 Slowloris）。

### 十、Logging、監控與稽核軌跡（金融科技情境）
- [ ] **記錄完整稽核軌跡（audit trail）**：登入/登出、授權失敗、資料存取（尤其財務/個資查詢）、狀態變更操作，含使用者身分、時間、來源。
- [ ] **對抗 OWASP API 不足的 logging & monitoring**：建立可偵測異常存取型態的監控。
- [ ] **log 不得含敏感值**：不記密碼、token、完整連線字串、個資明文；必要時做隱碼（masking）。
- [ ] **log 保存期限**：金管會《指定非公務機關個人資料檔案安全維護辦法》第 14 條要求金融機構軌跡資料「至少留存五年」；未特許 SaaS 依《個資法》施行細則第 12 條僅需保存「適當期間」（自訂、風險基礎），但建議對齊業界 5 年基準或至少 1 年。（政府機關另依資安管理法制度為「至少 6 個月」，可作下限參考。）
- [ ] **個資事故通報**：金融機構有「重大個資事故 72 小時內通報金管會」義務（該辦法第 6 條）；一般非公務機關目前尚無「已生效」的通用 72 小時規定，但 2025/11/11 個資法修正與 2026 預告之《個資事故通知通報及應變辦法》草案將導入 72 小時門檻（涉特種個資 / 逾 100 名當事人 / 系統含逾 1 萬筆），建議預先建立通報流程。
- [ ] **善用 Cloud Audit Logs + VPC-SC 稽核**，監控資源存取型態與 perimeter 違規。
- [ ] **設定告警**：對授權失敗暴增、429 暴增、SSRF 疑似樣態、含 bare-CR 的異常 HTTP 請求告警。

### 十一、常見 BFF 專屬漏洞與錯誤設定
- [ ] **錯誤處理不外洩 stack trace / SQL / 內部路徑 / 版本 / 內部主機名**（OWASP API8、A05；OWASP 明列 stack trace 外洩會揭露 SQL 查詢、DB 種類與版本）：正式環境用通用錯誤頁，詳情只進伺服器端 log；定義並強制 error response schema。
- [ ] **不把下游服務 URL / 內部錯誤原樣回傳前端**。
- [ ] **測試每一條錯誤路徑**（驗證失敗、授權失敗、格式錯誤、上游逾時、未預期例外），確保各 handler 都不外洩。
- [ ] **防 header injection**：對轉發下游的 header（如 `X-User-Id`）做嚴格產生與驗證，勿讓前端可注入。
- [ ] **不 fail open**：例外時應 fail secure（拒絕），勿因 catch-all 靜默吞錯而跳過權限檢查。
- [ ] **關閉未使用的功能、port、debug 模式、預設帳號**。
- [ ] **Improper Inventory Management（API9:2023）**：清點所有 API 版本與 endpoint，退役舊版、非正式環境勿曝露。
- [ ] **Unsafe Consumption of APIs（API10:2023）**：BFF 呼叫第三方（如行情資料商）時，同樣驗證其回應、走 TLS、不盲信。

### 十二、Cloud Run / 基礎設施部署資安
- [ ] **移除 `--allow-unauthenticated`**（除非確為公開端點）；用 `--no-allow-unauthenticated` 明確要求 IAM 驗證。
- [ ] **每服務專屬最小權限 SA**；用 IAM Recommender / Policy Analyzer 定期移除未用權限、找出 90 天未用 SA。
- [ ] **公網入口統一經 External ALB + Cloud Armor + IAP**，後端服務設 internal ingress。
- [ ] **內部使用者用 IAP，終端使用者用 Identity Platform / Firebase Auth**。
- [ ] **不把 secret 放環境變數**（見第六節）。
- [ ] **Docker image 硬化**：
  - [ ] 用 `node:22-slim`（較少套件、較少 CVE），並以 digest（`@sha256:...`）釘住確保可重現。
  - [ ] 多階段 build，runtime stage 只留 production 依賴（`pnpm install --frozen-lockfile --prod --offline`）。
  - [ ] **以 non-root 使用者執行**（建立 uid 10001 的 app 使用者，`USER` 指令置於需寫入動作之後；監聽 <1024 port 需額外 capability）。
  - [ ] 用 Dependabot/Renovate 自動追 digest 更新；CI 內 `docker scout` / `trivy` 掃描 OS 與 npm 依賴。
  - [ ] 設 `--memory`、`--pids-limit` 等資源上限，限制被入侵容器的破壞範圍。
- [ ] **Neon Postgres**：
  - [ ] 連線用 `sslmode=verify-full`（最嚴格，驗證 CA 與主機名），勿只用 `sslmode=require`（幾乎不防 MITM）。
  - [ ] Serverless 場景用 pooler endpoint；確認 driver 連線逾時容忍 cold start（≥5s）。
  - [ ] 開啟 IP Allow（Scale 方案）限制到應用 egress IP；或用 Private Networking（AWS PrivateLink）。
  - [ ] Neon 密碼要求至少 60-bit entropy；dev branch 與 prod 用不同憑證，branch 消滅時汰除舊 role。
- [ ] **組態持續稽核**：跨 orchestration files、API 元件、雲端服務權限定期檢視，自動化持續評估各環境設定。

---

## Recommendations（分階段行動建議）

**第一階段（立即，1–2 週內）——關閉最高風險缺口：**
1. 確認所有 BFF session cookie 具 `HttpOnly; Secure; SameSite`，並加 `__Host-` 前綴；access/refresh token 確實不進瀏覽器。
2. 移除所有內部微服務的 `--allow-unauthenticated`，改為專屬最小權限 SA + `roles/run.invoker` + ingress internal-only；強制 `iam.automaticIamGrantsForDefaultServiceAccounts` 組織政策。
3. 把 Neon 連線字串與 API keys 移入 Secret Manager（volume 掛載），並 grep 前端 bundle 確認無外洩；Neon 連線改 `sslmode=verify-full`。
4. CORS 改為明確 allowlist，移除任何 `origin: true` / 反射 origin。
5. 正式環境關閉 verbose error（不外洩 stack trace）。

**第二階段（1–2 個月）——結構性強化：**
6. 導入 CSRF 防護（自訂 header + 觸發 preflight，或 double-submit token）。
7. 對下游呼叫實作 audience 驗證與 per-hop token；SSRF allowlist + 封鎖私有網段/metadata。
8. Zod 全面驗證輸入；確認全部 SQL 走參數化；多租戶啟用 RLS。
9. Redis session store + token bucket 限流（per-user、成本加權）。
10. Docker 以 non-root + digest pin + CI 漏洞掃描；設資源上限。

**第三階段（季度）——法遵與韌性對齊：**
11. 建立稽核軌跡與集中式 log（去識別化），設定告警；建立個資事故 72 小時通報流程（預先對齊即將生效的通用規定）。
12. 導入 VPC Service Controls（先 dry-run）與 Cloud Armor / IAP 邊界。
13. 自願對齊金管會《零信任參考指引》的「傳統→起始」層級（雙因子、裝置識別、網路分段、最小權限、敏感資料加密 + DLP、ABAC 動態授權）。

**調整門檻（何時升級措施）：**
- 若**取得投顧/投信特許或被金管會公告指定**，或**成為銀行 TSP**：則《指定非公務機關個資檔案安全維護辦法》全套（董事會核定計畫、5 年 log、72 小時通報、電子商務安全控制）成為強制，須立即補齊。
- 若**使用者數 / 個資筆數成長至逾 1 萬筆**：預先落實草案門檻的 72 小時通報與加密要求。
- 若**導入即時下單或資金移轉**：升級為 step-up MFA、端到端 HTTP/2、mTLS / service mesh。

---

## Caveats（重要限制與不確定性）
- **法遵定位需自行以合格律師確認**：本清單依現行公開資料判斷「未特許獨立 SaaS 主要受《個資法》拘束、金管會金融資安規範原則上不直接拘束」，但「選股/量化分析」若涉及個別化投資建議，可能落入《證券投資顧問事業》特許範圍而使金管會規範適用——此為關鍵分界，務必確認。
- **部分 Taiwan 法規屬「即將生效 / 草案」**：2025/11/11 個資法修正（刪除舊第 27 條、新增通報義務）施行日由行政院另定、尚未生效；2026 年預告之《個資事故通知通報及應變辦法》草案（72 小時門檻）仍在 60 天預告期，屬草案非正式法律，應持續追蹤。
- **金管會《金融資安韌性發展藍圖》（2025/12，共 29 項措施、四軸架構）多屬規劃性措施**（用「將研訂」「規劃」等未來式），如 API 安全基準、SBOM、後量子密碼遷移指引等尚未成為拘束性規則，且對象為金融機構。
- **Cloud Run 網路限制會變動**：Direct VPC ingress 對 services/jobs 不支援等限制以 Google 官方文件為準，導入前請再核對最新版本。
- **`pg` driver SSL 行為將變更**：node-postgres v9.0.0 起 `sslmode=require` 語意將改為僅加密不驗證，故務必明寫 `verify-full` 並在升級時複驗。
- **本清單為稽核起點，非窮盡清單**：實際威脅模型應依你的資料敏感度與攻擊面再做滲透測試與威脅建模驗證。