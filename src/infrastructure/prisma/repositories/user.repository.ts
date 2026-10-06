import { getPrismaClient } from "@/infrastructure/prisma/index.js";
import type { User as UserRow } from "@/generated/prisma/client.js";
import type { UserPort } from "@/application/ports/user.js";
import type { UserProfile } from "@/application/user/user.types.js";

function toUserProfile(row: UserRow): UserProfile {
  return {
    id: row.id,
    firebaseUid: row.firebaseUid,
    email: row.email,
    displayName: row.displayName,
    createdAt: row.createdAt.toISOString(),
  };
}

async function findUserByFirebaseUid(firebaseUid: string): Promise<UserProfile | null> {
  const prisma = getPrismaClient();
  const row = await prisma.user.findUnique({ where: { firebaseUid } });
  return row ? toUserProfile(row) : null;
}

/**
 * Creates the row on first sight of an authenticated user, and returns the existing one afterwards.
 *
 * Until 2026-09-23 nothing in this service ever created a User row, so a perfectly valid Firebase
 * caller got a 404 from GET /users/me forever. That was tolerable while the row held nothing but a
 * display name; it stops being tolerable now that `createdAt` is what the 14-day reverse trial is
 * measured from — a user with no row would have no trial start, i.e. no entitlement at all.
 *
 * `update` deliberately rewrites email/displayName: Firebase is the source of truth for both, and a
 * user who changes their email there should not keep a stale copy here. Nothing else on the row is
 * touched, so `createdAt` — the trial anchor — can never be reset by a later login.
 */
async function ensureUserProvisioned(
  firebaseUid: string,
  email: string | null,
  displayName: string | null,
): Promise<UserProfile> {
  const prisma = getPrismaClient();
  const row = await prisma.user.upsert({
    where: { firebaseUid },
    update: { email, displayName },
    create: { firebaseUid, email, displayName },
  });
  return toUserProfile(row);
}

/**
 * UserPort 的 Prisma 實作，也是這個檔案唯一的對外匯出。
 *
 * 上面兩支函式原本是 export 的，因為 billing/entitlement.service.ts 直接 import 了 findUserByFirebaseUid；
 * 那個切片 2026-09-24 轉成 ports 之後就沒有第二個入口了，所以它們收回成模組內部函式。外面拿得到的只剩
 * 這個 adapter——「User 這張表只能經由 UserPort 碰」因此是編譯期擋得住的，不是靠慣例。
 */
async function ensureUserExists(firebaseUid: string): Promise<UserProfile> {
  const prisma = getPrismaClient();
  // update: {} — 已經存在就一個欄位都不動（尤其 email 與試用期錨點 createdAt）。
  const row = await prisma.user.upsert({ where: { firebaseUid }, update: {}, create: { firebaseUid } });
  return toUserProfile(row);
}

export const prismaUser: UserPort = {
  find: findUserByFirebaseUid,
  ensureProvisioned: ensureUserProvisioned,
  ensureExists: ensureUserExists,
};
