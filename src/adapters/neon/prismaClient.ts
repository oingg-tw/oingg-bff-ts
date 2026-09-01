import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client.js";
import { requireEnv } from "@/shared/env.js";

let client: PrismaClient | undefined;

/** Prisma-managed client for oingg-bff-ts's own database (DATABASE_URL) — this service owns this schema. */
export function getPrismaClient(): PrismaClient {
  if (!client) {
    const adapter = new PrismaPg({ connectionString: requireEnv("DATABASE_URL") });
    client = new PrismaClient({
      adapter,
      // Neon's compute auto-suspends when idle, so the first connection after a while (e.g. right
      // after this process boots) can take several seconds to wake up. Prisma's interactive-transaction
      // defaults (maxWait 2s to acquire the transaction, timeout 5s to run it) are tuned for an
      // always-warm connection and fail with P2028 ("Unable to start a transaction in the given time")
      // when that wake-up eats the maxWait budget — not because any query was actually slow.
      transactionOptions: { maxWait: 10_000, timeout: 10_000 },
    });
  }
  return client;
}

export async function closePrismaClient(): Promise<void> {
  await client?.$disconnect();
  client = undefined;
}
