import { getFirebaseAuth } from "@/infrastructure/firebase/client.js";
import type { TokenVerifierPort } from "@/application/ports/tokenVerifier.js";

/**
 * TokenVerifierPort 的 firebase-admin 實作，也是全 repo 唯一（除了啟動用的 initFirebase）叫得出
 * firebase-admin 的地方。
 *
 * 回傳的是 verifyIdToken 解出來的那個物件本身，沒有挑欄位重組：DecodedIdToken 在結構上就滿足
 * VerifiedIdentity，所以型別上收窄不需要在執行期動它。這件事有行為意義而不只是省一行——GET /auth/me
 * 直接把 req.user 整包 res.json 出去，重新組一個只有 uid/email/name 的物件會讓那支端點的回應少掉一堆
 * 欄位（前端拿得到的 claims 全不見）。要改那份回應內容是獨立的決定，不該由這次重構順手做掉。
 *
 * 驗證失敗原樣往上丟，不翻譯：呼叫端要把原始訊息放進 401 的 details。
 */
export const firebaseTokenVerifier: TokenVerifierPort = {
  verifyIdToken(idToken) {
    return getFirebaseAuth().verifyIdToken(idToken);
  },
};
