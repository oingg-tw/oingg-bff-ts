import type { VerifiedIdentity } from "@/application/user/user.types.js";

/**
 * ID token 的驗證 port。實作住 infrastructure/firebase/tokenVerifier.ts。
 *
 * 重構前 http/middleware/auth.middleware.ts 直接 import firebase-admin，而 application/auth/auth.types.ts
 * 又把 firebase 的 DecodedIdToken 再匯出一次——等於「這個系統用哪一家身分供應商」這件事同時漏進了 http 與
 * application 兩層。換掉 Firebase 要改的檔案因此散落各處，而不是只有 bootstrap 那一行。
 *
 * 回傳型別是 VerifiedIdentity（application/user/user.types.ts 早就為了同一個理由定義的結構子集），不是
 * DecodedIdToken：application 不該叫得出任何一家 SDK 的型別名。實作端回傳的仍然是驗證後的原物件本身，
 * 只是型別上收窄——GET /auth/me 把 req.user 整包序列化出去的行為因此一個 byte 都沒變。
 *
 * 只有「驗證」一個方法：發 token、換 token、撤銷 session 都不是這個服務做的事，Firebase 那邊做。
 */
export interface TokenVerifierPort {
  /**
   * 驗章 + 驗效期，通過回傳其中的身分欄位。
   *
   * 失敗一律用 throw，不回傳 null：呼叫端（requireAuth/optionalAuth）要把原始錯誤訊息塞進 401 的 details
   * 裡，翻譯成 null 會把那份訊息丟掉。「header 根本沒帶」是呼叫端自己判斷的事，不會走到這裡。
   */
  verifyIdToken(idToken: string): Promise<VerifiedIdentity>;
}
