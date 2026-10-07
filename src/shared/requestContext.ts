import { AsyncLocalStorage } from "node:async_hooks";

/**
 * 目前這個請求的 ID，讓出站呼叫不必一路把它當參數傳下去（2026-10-08）。fetchAnalysisService 把它帶成
 * `X-Request-Id` 送給 analysis-ts，他們沿用成自己的 `instance` 與 log，所以同一個 ID 貫穿兩邊的 log。
 *
 * 在 routes.ts 的內層 Router 才 run，不在 app 層的 requestLogger：POST 的 body 是 uWS 從原生回呼送進來的，
 * 在 body 解析之前建立的 context 會在那裡斷掉。不在請求裡的呼叫（啟動時的目錄同步）沒有 store，就不帶。
 */
export const requestContext = new AsyncLocalStorage<{ requestId: string }>();
