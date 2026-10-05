import { beforeEach } from "vitest";
import { resetStockDividendCache } from "@/application/holdings/stockDividendLedger.js";

/**
 * 測試環境的必要環境變數預設值。
 *
 * **為什麼需要這個檔案**：`src/shared/env.ts` 的 `requireEnv()` 在缺變數時直接丟錯，而本機跑測試時那些
 * 值是從 `.env` 被動載入的（`dotenv/config` 在 env.ts 第一行）。`.env` 是 gitignored、也被
 * `.gcloudignore` 排除，所以在 CI、在別人的全新 clone 上都不存在——2026-09-29 第一次 push 觸發
 * Cloud Build 時，819 個測試裡有 379 個因此失敗（`Missing required environment variable: BFF_API_KEY`），
 * 而同一份程式碼在本機是全綠的。
 *
 * **刻意無條件覆寫，不是 `??=`**：測試不該因為某個人的 `.env` 內容不同而有不同結果。dotenv 預設不覆寫
 * 已存在的變數，而 setup 檔在測試檔 import 模組之前執行，所以這裡設完之後 `.env` 就影響不到測試了。
 * 個別測試在 `beforeEach` 裡設的值仍然優先（那些在這之後才跑）。
 *
 * 這些值全部是明顯的假值：如果哪個測試真的把它們拿去連線，錯誤訊息會直接指出是這裡的值，而不是看起來
 * 像一個合理的真實設定。
 */
process.env.FILTERS_SERVICE_URL = "http://filters.test";
process.env.BFF_API_KEY = "test-key";
process.env.FILTERS_SYNC_SECRET = "test-sync-secret";
process.env.API_DOCS_USER = "test-docs-user";
process.env.API_DOCS_PASSWORD = "test-docs-password";
process.env.RESEND_API_KEY = "re_test_key";
process.env.DATABASE_URL = "postgresql://placeholder:placeholder@localhost:5432/placeholder";

/**
 * 自動配股的行事曆快取是模組層的狀態，會跨測試保留：前一個測試快取了「這個月沒有配股」，後一個
 * 測試提供的配股就會被忽略，變成看執行順序決定的測試。每個測試前清一次。
 */
beforeEach(() => {
  resetStockDividendCache();
});
