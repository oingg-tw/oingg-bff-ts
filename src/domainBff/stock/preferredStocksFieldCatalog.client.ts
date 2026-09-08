import { AppError } from "@/shared/errorHandler.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/shared/analysisServiceClient.js";
import type {
  PreferredStockFieldCatalogEntry,
  PreferredStockFieldCatalogResult,
} from "@/domainBff/stock/preferredStocksFieldCatalog.types.js";

function normalizeFieldCatalogEntry(raw: unknown): PreferredStockFieldCatalogEntry {
  const r = raw as Record<string, unknown>;
  return {
    field: String(r.field),
    label: String(r.label),
    formula: String(r.formula),
    inputs: Array.isArray(r.inputs) ? r.inputs.map(String) : [],
  };
}

/**
 * Static documentation of how analysis-ts derives preferred-stock fields (premiumRatePct, ytcPct, etc.)
 * from raw inputs — from analysis-ts's GET /preferred-stocks/field-catalog. Confirmed with analysis-ts
 * directly (2026-09-08): no DB query, not affected by any query params, same response every time.
 */
export async function fetchPreferredStockFieldCatalog(): Promise<PreferredStockFieldCatalogResult> {
  const url = buildAnalysisServiceUrl("/preferred-stocks/field-catalog");
  const response = await fetchAnalysisService(url);
  assertAnalysisServiceOk(response, url, "Preferred stock field catalog endpoint");

  const body = (await response.json()) as { fields?: unknown };
  if (!Array.isArray(body.fields)) {
    throw new AppError("Preferred stock field catalog response is missing a fields array", 502);
  }

  return { fields: body.fields.map(normalizeFieldCatalogEntry) };
}
