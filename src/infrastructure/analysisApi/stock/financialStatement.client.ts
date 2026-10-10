import { AppError } from "@/domain/appError.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService, renamedField, toNumberOrNull } from "@/infrastructure/analysisApi/analysisServiceClient.js";
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

  // 批次 2c 新名優先、舊名後備（上游 2026-10-24 移除舊名，而部署的 analysis-ts 不一定已有新名）。舊 year 是民國年字串，
  // 要換算；舊名移除、DEV 也部署之後把後備刪掉。
  // 判斷「新名在不在」，**不是用 ??**：found 為 false 時上游的新名是 null、舊 year 卻回顯查詢的年度（實測 2026-10-10，
  // 6488 2019Q4 損益表：year "108"、fiscalYear null；上游 fb65b1b1 已改成兩邊一致）。用 ?? 會把那個回顯當成真的年度補進 fiscalYear。
  const legacyRocYear = typeof body.year === "string" && /^\d{2,3}$/.test(body.year) ? Number(body.year) : null;
  const legacySeason = typeof body.season === "string" && /^[1-4]$/.test(body.season) ? Number(body.season) : null;
  const periodYear = "fiscalYear" in body ? toNumberOrNull(body.fiscalYear) : legacyRocYear === null ? null : legacyRocYear + 1911;
  const periodQuarter = "fiscalQuarter" in body ? toNumberOrNull(body.fiscalQuarter) : legacySeason;
  const fiscalPeriodEndDate = toStringOrNull(renamedField(body, "fiscalPeriodEndDate", "reportDate"));
  return {
    symbol: typeof body.symbol === "string" ? body.symbol : symbol,
    statementType,
    dataType: toStringOrNull(body.dataType),
    subsidiaryCompanyId: toStringOrNull(body.subsidiaryCompanyId),
    fiscalYear: periodYear,
    fiscalQuarter: periodQuarter,
    fiscalPeriodEndDate,
    found: body.found === true,
    statement: normalizeStatement(body.statement),
  };
}
