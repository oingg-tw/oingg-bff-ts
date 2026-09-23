import { getPrismaClient } from "@/infrastructure/prisma/index.js";
import type { Subscription as SubscriptionRow } from "@/generated/prisma/client.js";
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
export async function findSubscriptionByFirebaseUid(firebaseUid: string): Promise<SubscriptionRecord | null> {
  const prisma = getPrismaClient();
  const row = await prisma.subscription.findUnique({ where: { firebaseUid } });
  return row ? toSubscriptionRecord(row) : null;
}
