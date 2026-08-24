import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.js";
import { requireEnv } from "../../shared/env.js";

let client: PrismaClient | undefined;

/** Prisma-managed client for oingg-bff-ts's own database (APP_DATABASE_URL) — this service owns this schema. */
export function getPrismaClient(): PrismaClient {
  if (!client) {
    const adapter = new PrismaPg({ connectionString: requireEnv("APP_DATABASE_URL") });
    client = new PrismaClient({ adapter });
  }
  return client;
}

export async function closePrismaClient(): Promise<void> {
  await client?.$disconnect();
  client = undefined;
}
