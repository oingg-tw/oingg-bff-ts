import { AppError } from "@/domain/appError.js";
import {
  assertAnalysisServiceOk,
  buildAnalysisServiceUrl,
  fetchAnalysisService,
  requireNumber,
  toNumberOrNull,
  toStringOrNull,
} from "@/infrastructure/analysisApi/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type { ValuationRiverRatio, ValuationRiverResult } from "@/application/proxy/stock/valuationRiver.types.js";

const LABEL = "Valuation river";

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    logger.error({ field, received: typeof value }, `${LABEL} is missing a string field upstream guarantees`);
    throw new AppError(`${LABEL} response is missing the field ${field}`, 502);
  }
  return value;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * 逐欄位依上游 OpenAPI（2026-10-08 讀過）：必填的走 requireNumber／requireString，缺了 502 指名欄位；
 * 標 nullable 的走 toNumberOrNull／toStringOrNull，保留 null——不要用 Number()／String()，那會把「沒有值」
 * 捏造成 0 或 "null"（2026-10-07 全面盤點過一次這類錯）。
 */
function normalize(body: unknown, ratio: ValuationRiverRatio): ValuationRiverResult {
  const r = asObject(body);
  if (!r || !Array.isArray(r.prices) || !Array.isArray(r.bases)) {
    throw new AppError(`${LABEL} response is missing prices/bases arrays`, 502);
  }
  const lookback = asObject(r.lookback) ?? {};
  const range = asObject(r.ratioRange);
  const current = asObject(r.current);
  return {
    symbol: requireString(r.symbol, "symbol"),
    ratio,
    basisNote: requireString(r.basisNote, "basisNote"),
    lookback: {
      requestedYears: requireNumber(lookback.requestedYears, "lookback.requestedYears", LABEL),
      from: toStringOrNull(lookback.from),
      to: toStringOrNull(lookback.to),
    },
    sampleDays: requireNumber(r.sampleDays, "sampleDays", LABEL),
    bandMultiples: Array.isArray(r.bandMultiples) ? r.bandMultiples.map((m, i) => requireNumber(m, `bandMultiples[${i}]`, LABEL)) : null,
    ratioRange: range && { min: requireNumber(range.min, "ratioRange.min", LABEL), max: requireNumber(range.max, "ratioRange.max", LABEL) },
    current: current && {
      tradeDate: requireString(current.tradeDate, "current.tradeDate"),
      price: requireNumber(current.price, "current.price", LABEL),
      base: toNumberOrNull(current.base),
      ratio: toNumberOrNull(current.ratio),
      percentile: toNumberOrNull(current.percentile),
    },
    prices: r.prices.map((raw) => {
      const p = asObject(raw) ?? {};
      return { tradeDate: requireString(p.tradeDate, "prices[].tradeDate"), close: requireNumber(p.close, "prices[].close", LABEL) };
    }),
    bases: r.bases.map((raw) => {
      const b = asObject(raw) ?? {};
      return {
        effectiveFrom: requireString(b.effectiveFrom, "bases[].effectiveFrom"),
        base: toNumberOrNull(b.base),
        fiscalYear: requireNumber(b.fiscalYear, "bases[].fiscalYear", LABEL),
        fiscalQuarter: toNumberOrNull(b.fiscalQuarter),
        knowledgeDateIsFallback: b.knowledgeDateIsFallback === true,
      };
    }),
  };
}

/**
 * 估值河流圖，轉發 analysis-ts 的 GET /companies/valuation-river?symbol=&ratio=&lookbackYears=（2026-10-08，
 * web-nuxt 用它取代個股 pe-ratio／pb-ratio／psr 頁原本的河流圖）。lookbackYears 省略時不送，上游預設 5 年。
 * 上游的 400 照 assertAnalysisServiceOk 的規則原樣轉回 400。
 */
export async function fetchValuationRiver(symbol: string, ratio: ValuationRiverRatio, lookbackYears?: number): Promise<ValuationRiverResult> {
  const params: Record<string, string> = { symbol, ratio };
  if (lookbackYears !== undefined) {
    params.lookbackYears = String(lookbackYears);
  }
  const url = buildAnalysisServiceUrl("/companies/valuation-river", params);
  const response = await fetchAnalysisService(url);
  await assertAnalysisServiceOk(response, url, "Valuation river endpoint");
  return normalize(await response.json(), ratio);
}
