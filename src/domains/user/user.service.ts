import { AppError } from "../../shared/errorHandler.js";
import { findUserByFirebaseUid } from "./user.repository.js";
import type { UserProfile } from "./user.types.js";

export { findUserByFirebaseUid };

export async function getUserByFirebaseUidOrThrow(firebaseUid: string): Promise<UserProfile> {
  const user = await findUserByFirebaseUid(firebaseUid);
  if (!user) {
    throw new AppError(`No user found for firebase uid "${firebaseUid}"`, 404);
  }
  return user;
}
