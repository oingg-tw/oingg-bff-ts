import type { UserProfile } from "@/application/user/user.types.js";

/**
 * 使用者本體（User 那一列：識別 + 開通）的持久化 port。實作住
 * infrastructure/prisma/repositories/user.repository.ts。
 *
 * 這個 port 跟 UserPreferencesPort 刻意分開：User 這一列不是偏好設定，它是帳號本身——`createdAt` 是
 * 14 天反向試用期的起算點（見 billing/entitlement.service.ts），刪掉它等於刪掉一個人的訂閱狀態，而偏好
 * 設定刪掉只是回到預設值。兩者生命週期與風險等級不同，混在同一個介面會讓這件事看不出來。
 */
export interface UserPort {
  /** null 代表這個 firebaseUid 還沒有任何一列——尚未開通，不是錯誤。 */
  find(firebaseUid: string): Promise<UserProfile | null>;

  /**
   * 第一次見到這個使用者時建立該列，之後回傳既有的那一列（upsert 語意）。
   *
   * email/displayName 會被覆寫：Firebase 是這兩個欄位的真實來源，在那邊改了 email 不該在這裡留一份過期
   * 的。其餘欄位一律不動，所以 `createdAt`（試用期錨點）不可能被之後的登入重設。
   */
  ensureProvisioned(
    firebaseUid: string,
    email: string | null,
    displayName: string | null,
  ): Promise<UserProfile>;
}
