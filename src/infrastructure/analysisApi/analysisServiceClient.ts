import { AppError } from "@/domain/appError.js";
import { ANALYSIS_SERVICE_TIMEOUT_MS, requireEnv } from "@/shared/env.js";
import { logger } from "@/shared/logger.js";

/** Builds a URL against analysis-ts's FILTERS_SERVICE_URL host, optionally setting query params. */
export function buildAnalysisServiceUrl(path: string, searchParams?: Record<string, string>): URL {
  const url = new URL(path, requireEnv("FILTERS_SERVICE_URL"));
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, value);
    }
  }
  return url;
}

/**
 * fetch() itself throws (not a rejected-but-caught HTTP response) for connection-level failures —
 * refused/unreachable host, DNS, timeout — converted here to a clear 502 instead of an uncaught 500.
 * The internal URL is logged server-side only; the client-facing message never includes it (would leak
 * bff-ts's internal service topology to the end user — see errorHandler.ts, which only gates `details`
 * by NODE_ENV, never `message`).
 *
 * analysis-ts requires an `X-Api-Key` header on every domainApi request as of 2026-09-04 (health check
 * and /batch/compute are the only exceptions, neither of which bff-ts calls) — attached here, the single
 * place every outbound request already flows through, so every call site gets it automatically.
 *
 * 2026-09-28: production analysis-ts 會部署成「只允許授權的服務帳戶呼叫」（沒有 allUsers），所以除了
 * X-Api-Key 之外還要帶一個 Google ID token。兩層都送、不是二選一。同樣加在這裡，理由跟上面一樣。
 */
export async function fetchAnalysisService(url: URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("X-Api-Key", requireEnv("BFF_API_KEY"));
  const idToken = await analysisServiceIdToken();
  if (idToken) {
    headers.set("Authorization", `Bearer ${idToken}`);
  }
  try {
    return await fetch(url, { ...init, headers, signal: AbortSignal.timeout(ANALYSIS_SERVICE_TIMEOUT_MS) });
  } catch (error) {
    logger.error({ err: error, url: url.toString() }, "Could not reach the analysis service");
    throw new AppError("Could not reach the analysis service", 502);
  }
}

/**
 * Cloud Run 的 metadata server。只在 Google 的運算環境裡存在——本機、CI 都沒有，所以下面靠
 * ANALYSIS_SERVICE_AUDIENCE 有沒有設來決定要不要走這條路，而不是靠「試著連連看」。
 */
const METADATA_IDENTITY_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity";

/** 提早 5 分鐘換新：ID token 有效期一小時，留足夠餘裕吸收時鐘偏差與換發失敗的重試。 */
const ID_TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;

let cachedIdToken: { token: string; audience: string; expiresAt: number } | undefined;

/** 只給測試用：清掉快取，否則第二個測試會看到第一個測試留下的 token。 */
export function resetAnalysisServiceIdTokenCache(): void {
  cachedIdToken = undefined;
}

/**
 * 取一個給 analysis-ts 用的 Google ID token，**沒有設 ANALYSIS_SERVICE_AUDIENCE 就回 undefined**。
 *
 * 那個「沒設就什麼都不做」是刻意的：本機開發打的是 http://localhost:5000，那裡沒有 IAM 也沒有 metadata
 * server，如果這裡改成「總是嘗試」，每一個本機請求都會先去撞一個不存在的主機、等它逾時。所以開關是
 * 明確的設定而不是環境偵測。
 *
 * **取不到就丟 502（fail closed）**，不會退化成「不帶 token 硬送」：那只會把一個明確的本地錯誤換成
 * 上游一個難解讀的 403，而且會讓「我們以為有授權其實沒有」這種狀態靜默存在。
 *
 * audience 必須是對方 Cloud Run 服務的 URL（不含路徑）；那個字串由 analysis-ts 部署後提供，不自己組。
 */
async function analysisServiceIdToken(): Promise<string | undefined> {
  const audience = process.env.ANALYSIS_SERVICE_AUDIENCE;
  if (!audience) {
    return undefined;
  }

  const now = Date.now();
  if (cachedIdToken && cachedIdToken.audience === audience && cachedIdToken.expiresAt > now) {
    return cachedIdToken.token;
  }

  const url = new URL(METADATA_IDENTITY_URL);
  url.searchParams.set("audience", audience);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "Metadata-Flavor": "Google" },
      signal: AbortSignal.timeout(ANALYSIS_SERVICE_TIMEOUT_MS),
    });
  } catch (error) {
    logger.error({ err: error, audience }, "Could not reach the metadata server for an ID token");
    throw new AppError("Could not obtain credentials for the analysis service", 502);
  }
  if (!response.ok) {
    logger.error({ status: response.status, audience }, "Metadata server refused to issue an ID token");
    throw new AppError("Could not obtain credentials for the analysis service", 502);
  }

  const token = (await response.text()).trim();
  if (!token) {
    throw new AppError("Metadata server returned an empty ID token", 502);
  }
  // 不解 JWT 去讀 exp：那需要一個 base64url + JSON 的解析，而失效只會讓我們多換一次 token。
  // 固定 55 分鐘（一小時減去餘裕）比解析出來的精確值便宜，而且錯的方向是安全的那一邊。
  cachedIdToken = { token, audience, expiresAt: now + 60 * 60_000 - ID_TOKEN_REFRESH_MARGIN_MS };
  return token;
}

/**
 * Throws a generic 502 (never including the internal URL) for a non-ok response. Callers needing
 * custom handling for a specific status first (404 → null, 400 → relay analysis-ts's own message)
 * should branch on `response.status` before calling this.
 */
export function assertAnalysisServiceOk(response: Response, url: URL, label: string): void {
  if (!response.ok) {
    logger.error({ url: url.toString(), status: response.status }, `${label} returned a non-2xx status`);
    throw new AppError(`${label} returned ${response.status}`, 502);
  }
}

/**
 * 讀一個「上游保證一定是數字」的欄位，缺了就在邊界上丟 502 而不是靜默給 null 或 0。
 *
 * 2026-09-27 從 dividendHistory.client.ts 的私有函式抽上來（book-value-breakdown 是第二個呼叫端）。
 * 當初的脈絡：上游改名而 bff-ts 還讀舊名時，`Number(undefined)` 產生 NaN、序列化成 null，而型別說那個
 * 欄位不可為 null——版本錯開被型別吸收掉，只能靠手動打上游比對才發現。丟 502 讓一個請求就講出是哪個
 * 欄位不見了。代價是改版空窗期那支端點會整支失敗，那是正確的：資料確實無法以宣告的形狀提供。
 *
 * **不要用在「上游可能為 null」的欄位上**——那種欄位的型別本來就該是 `number | null`，用
 * `typeof value === "number" && Number.isFinite(value) ? value : null` 判斷（別用 `Number()`，
 * `Number(null)` 是 0 不是 NaN，見 dailyPriceHistory.client.ts 的說明）。
 */
export function requireNumber(value: unknown, field: string, label: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    logger.error({ field, received: typeof value }, `${label} is missing a field upstream guarantees — likely a field rename that bff-ts has not followed`);
    throw new AppError(`${label} response is missing the numeric field ${field}`, 502);
  }
  return value;
}

