import { timingSafeEqual } from "node:crypto";

/** `docker run --env-file` doesn't strip quotes the way dotenv does — same fix as oingg-twse-ts's TASK_SECRET. */
export function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

/** Constant-time string comparison — a length check up front would leak length via timing, so pad instead of short-circuiting. */
export function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
