import { AppError } from "@/shared/errorHandler.js";
import { findUserByFirebaseUid } from "@/domains/user/user.repository.js";
import type { UserProfile } from "@/domains/user/user.types.js";

export { findUserByFirebaseUid };

export async function getUserByFirebaseUidOrThrow(firebaseUid: string): Promise<UserProfile> {
  const user = await findUserByFirebaseUid(firebaseUid);
  if (!user) {
    throw new AppError(`No user found for firebase uid "${firebaseUid}"`, 404);
  }
  return user;
}
