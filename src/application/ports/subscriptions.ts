import type { SubscriptionRecord } from "@/application/billing/billing.types.js";

/**
 * 訂閱列（Subscription）的讀取 port。實作住
 * infrastructure/prisma/repositories/billing.repository.ts。
 *
 * 刻意只有讀：唯一的寫入者將會是金流 webhook（Phase 1）。在有確定的呼叫端之前就先開一個寫入方法，正是
 * 「自助把自己變成訂閱戶」的端點被不小心寫出來的方式——所以這個 port 連寫的字彙都不提供。
 *
 * 跟 UserPort 分開而不是合併：User 那一列是帳號本身（createdAt 是反向試用期的錨點），Subscription 是付款
 * 狀態，兩者由不同的東西寫入、也有不同的風險等級。
 */
export interface SubscriptionsPort {
  /** null 代表這個使用者從來沒有訂閱列——不是錯誤，是免費/試用中的正常狀態。 */
  find(firebaseUid: string): Promise<SubscriptionRecord | null>;
}
