import { queryNeon } from "../../adapters/neon/index.js";
import { AppError } from "../../shared/errorHandler.js";
import type { UserProfile } from "./user.types.js";

/** Name of the Neon pool (MAIN_DATABASE_URL) that owns the user profile table. */
const USER_DB = "main";

interface UserRow {
  id: string;
  firebase_uid: string;
  email: string | null;
  display_name: string | null;
  created_at: Date;
}

function toUserProfile(row: UserRow): UserProfile {
  return {
    id: row.id,
    firebaseUid: row.firebase_uid,
    email: row.email,
    displayName: row.display_name,
    createdAt: row.created_at.toISOString(),
  };
}

export async function findUserByFirebaseUid(firebaseUid: string): Promise<UserProfile | null> {
  const result = await queryNeon<UserRow>(
    USER_DB,
    "select id, firebase_uid, email, display_name, created_at from users where firebase_uid = $1",
    [firebaseUid],
  );

  const row = result.rows[0];
  return row ? toUserProfile(row) : null;
}

export async function getUserByFirebaseUidOrThrow(firebaseUid: string): Promise<UserProfile> {
  const user = await findUserByFirebaseUid(firebaseUid);
  if (!user) {
    throw new AppError(`No user found for firebase uid "${firebaseUid}"`, 404);
  }
  return user;
}
