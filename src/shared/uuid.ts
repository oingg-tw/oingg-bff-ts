import { AppError } from "./errorHandler.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validates a route param is a UUID-shaped string — every user-owned resource's id is a UUID (see prisma/schema.prisma). */
export function parseUuidParam(raw: string, resourceName: string): string {
  if (!UUID_PATTERN.test(raw)) {
    throw new AppError(`Invalid ${resourceName} id "${raw}"`, 400);
  }
  return raw;
}
