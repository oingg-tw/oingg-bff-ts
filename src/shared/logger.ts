import pino from "pino";
import { env } from "@/shared/env.js";

/**
 * Structured (JSON) logging, not pretty-printed — bff-ts is this system's request gateway, so having
 * every log line machine-parseable (level/time/msg/err as real fields, not string-interpolated) matters
 * more here than local readability. twse-ts/analysis-ts already made the same move; see
 * feedback_scale_appropriate_governance memory for why this was worth doing now rather than deferred.
 */
export const logger = pino({
  // vitest sets NODE_ENV=test by default — silenced there so test output stays readable (real log
  // calls still run, just discarded, so a bug in a log call itself would still throw and fail the test).
  level: env.nodeEnv === "test" ? "silent" : env.isProduction ? "info" : "debug",
  serializers: { err: pino.stdSerializers.err },
});
