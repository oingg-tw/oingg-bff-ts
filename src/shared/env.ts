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

export { requireEnv };
