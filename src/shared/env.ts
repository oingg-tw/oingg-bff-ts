import "dotenv/config";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Frontend dev server default. Add more with a comma-separated CORS_ORIGINS env var.
const DEFAULT_CORS_ORIGINS = "http://localhost:3000";

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3000),
  isProduction: (process.env.NODE_ENV ?? "development") === "production",
  corsOrigins: (process.env.CORS_ORIGINS ?? DEFAULT_CORS_ORIGINS)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
};

/**
 * bff-ts's entire purpose is fronting exactly one upstream dependency (analysis-ts) — every outbound
 * `fetch()` to it must be bounded, or a single stalled analysis-ts request hangs indefinitely and takes
 * the corresponding bff-ts request down with it (no isolation, since there's nothing else in the way).
 * Applied via `signal: AbortSignal.timeout(ANALYSIS_SERVICE_TIMEOUT_MS)` in each *.client.ts file that
 * calls analysis-ts. 10s is generous for a same-region HTTP call but still a real bound.
 */
export const ANALYSIS_SERVICE_TIMEOUT_MS = 10_000;

export { requireEnv };
