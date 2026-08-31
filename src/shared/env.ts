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
 * dotenv already strips quotes from a `.env` file's own values, but other ways of setting env vars
 * (docker `--env-file`, Cloud Run/Render dashboard fields, etc.) don't — a secret pasted as
 * TASK_SECRET="xxx" would keep the literal quotes there and never match what a caller sends. Stripping
 * defensively at read-time normalizes both sources instead of trusting how each deploy target handles it.
 */
function stripQuotes(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  const isDoubleQuoted = trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"');
  const isSingleQuoted = trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'");
  return isDoubleQuoted || isSingleQuoted ? trimmed.slice(1, -1) : trimmed;
}

export { requireEnv, stripQuotes };
