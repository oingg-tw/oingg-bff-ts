import { getPrismaClient } from "@/infrastructure/prisma/index.js";
import type { Subscription as SubscriptionRow } from "@/generated/prisma/client.js";
import type { SubscriptionsPort } from "@/application/ports/subscriptions.js";
import type { SubscriptionRecord } from "@/application/billing/billing.types.js";

function toSubscriptionRecord(row: SubscriptionRow): SubscriptionRecord {
  return {
    firebaseUid: row.firebaseUid,
    status: row.status,
    plan: row.plan,
    currentPeriodEnd: row.currentPeriodEnd.toISOString(),
    provider: row.provider,
    providerPeriodNo: row.providerPeriodNo,
  };
}

/**
 * Read-only by design. There is deliberately no create/update function here yet: the only writer will
 * be the payment webhook (Phase 1), and adding a write path before there's a verified caller for it is
 * how a self-service "make me a subscriber" endpoint gets written by accident.
 */
async function findSubscriptionByFirebaseUid(firebaseUid: string): Promise<SubscriptionRecord | null> {
  const prisma = getPrismaClient();
  const row = await prisma.subscription.findUnique({ where: { firebaseUid } });
  return row ? toSubscriptionRecord(row) : null;
}

/**
 * SubscriptionsPort 的 Prisma 實作。
 *
 * `currentPeriodEnd` 在這裡就從 Date 轉成 ISO 字串（見 toSubscriptionRecord）：entitlement 的判斷要拿它
 * 跟 now 比大小，讓 application 收到已經正規化的字串，那段規則就不必知道任何驅動的日期型別。
 */
export const prismaSubscriptions: SubscriptionsPort = {
  find: findSubscriptionByFirebaseUid,
};
