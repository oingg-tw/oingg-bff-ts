import { getPrismaClient } from "../../adapters/neon/index.js";
import type { User as UserRow } from "../../generated/prisma/client.js";
import type { UserProfile } from "./user.types.js";

function toUserProfile(row: UserRow): UserProfile {
  return {
    id: row.id,
    firebaseUid: row.firebaseUid,
    email: row.email,
    displayName: row.displayName,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function findUserByFirebaseUid(firebaseUid: string): Promise<UserProfile | null> {
  const prisma = getPrismaClient();
  const row = await prisma.user.findUnique({ where: { firebaseUid } });
  return row ? toUserProfile(row) : null;
}
