import { stripQuotes, timingSafeEqualString } from "@/shared/secretAuth.js";

type HeaderBag = { ip?: string; headers: Record<string, unknown> };

const NITRO_KEY_HEADER = "x-oingg-nitro-key";
const CLIENT_IP_HEADER = "x-oingg-client-ip";

/**
 * 這個請求是不是 web-nuxt 的 Nitro 伺服器打來的（2026-10-08，使用者決定 Nitro 是真正的 BFF、瀏覽器不再
 * 直連業務中台）。Nitro 帶 `X-Oingg-Nitro-Key`，跟 `NITRO_SHARED_SECRET` 做常數時間比對，作法同
 * filterSyncAuth（stripQuotes + timingSafeEqual）。
 *
 * **沒設 NITRO_SHARED_SECRET 時一律 false**——fail closed：伺服器沒設密鑰，就沒有任何呼叫端能讓我們信任它
 * 轉來的客戶端 IP。這不是門禁（不擋請求），只決定要不要信任 X-Oingg-Client-Ip。部署時再加 Cloud Run IAM 與
 * 內部 ingress，那才是「只有 Nitro 進得來」的那一層；這個密鑰在本機與任何主機上都能用，所以先做這個。
 */
export function isFromNitro(req: HeaderBag): boolean {
  const expected = process.env.NITRO_SHARED_SECRET;
  const provided = req.headers[NITRO_KEY_HEADER];
  return Boolean(expected) && typeof provided === "string" && timingSafeEqualString(provided, stripQuotes(expected ?? ""));
}

/**
 * 真正的使用者 IP。Nitro 是唯一呼叫端時，所有請求的 X-Forwarded-For 最右邊都是 Nitro 自己的出口位址，
 * 所以**經過驗證的** Nitro 請求改用它轉來的 `X-Oingg-Client-Ip`（它取的是瀏覽器那一段 XFF 的最右邊）。
 * 未經驗證的請求照舊取 XFF 最右邊——routes.ts 的 rateLimitKey 說明為什麼是最右邊、不設 trust proxy。
 */
export function clientIpOf(req: HeaderBag): string {
  if (isFromNitro(req)) {
    const forwarded = req.headers[CLIENT_IP_HEADER];
    if (typeof forwarded === "string" && forwarded.trim()) {
      return forwarded.trim();
    }
  }
  const xff = req.headers["x-forwarded-for"];
  const chain = Array.isArray(xff) ? xff.join(",") : typeof xff === "string" ? xff : "";
  return chain.split(",").at(-1)?.trim() || req.ip || "unknown";
}
