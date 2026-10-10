import { AppError } from "@/domain/appError.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/infrastructure/analysisApi/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type { FinancialStatementResult, FinancialStatementType } from "@/application/proxy/stock/financialStatement.types.js";

function toStringOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function normalizeStatement(raw: unknown): Record<string, string | null> | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const result: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    result[key] = toStringOrNull(value);
  }
  return result;
}

function isFinancialStatementResponse(body: unknown): body is Record<string, unknown> {
  return typeof body === "object" && body !== null;
}

/**
 * Fetches one quarter's complete raw statement (balance sheet/income statement/cash flow statement) from
 * analysis-ts's GET /companies/financial-statement. Omitting year/season gets the latest quarter on
 * file. Always 200 — an unknown symbol or a quarter with no filed statement comes back with
 * `found: false` and `statement: null`, never a 404 (confirmed with analysis-ts directly).
 */
export async function fetchFinancialStatement(
  symbol: string,
  statementType: FinancialStatementType,
  fiscalYear?: number,
  fiscalQuarter?: number,
): Promise<FinancialStatementResult> {
  const searchParams: Record<string, string> = { symbol, statementType };
  // 西元 fiscalYear／整數 fiscalQuarter（analysis-ts 05967082，2026-10-10）；舊的民國 year／season 上游 2026-10-24 移除。
  if (fiscalYear !== undefined) {
    searchParams.fiscalYear = String(fiscalYear);
  }
  if (fiscalQuarter !== undefined) {
    searchParams.fiscalQuarter = String(fiscalQuarter);
  }

  const url = buildAnalysisServiceUrl("/companies/financial-statement", searchParams);
  const response = await fetchAnalysisService(url);
  await assertAnalysisServiceOk(response, url, "Financial statement endpoint");

  const body: unknown = await response.json();
  if (!isFinancialStatementResponse(body)) {
    logger.error({ url: url.toString() }, "Financial statement endpoint response is not an object");
    throw new AppError("Financial statement endpoint response is not an object", 502);
  }

  return {
    symbol: typeof body.symbol === "string" ? body.symbol : symbol,
    statementType,
    dataType: toStringOrNull(body.dataType),
    subsidiaryCompanyId: toStringOrNull(body.subsidiaryCompanyId),
    year: toStringOrNull(body.year),
    season: toStringOrNull(body.season),
    reportDate: toStringOrNull(body.reportDate),
    found: body.found === true,
    statement: normalizeStatement(body.statement),
  };
}
