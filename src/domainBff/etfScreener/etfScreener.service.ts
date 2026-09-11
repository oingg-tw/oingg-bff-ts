import { AppError } from "@/shared/errorHandler.js";
import {
  fetchEtfFieldCatalog,
  fetchEtfScreenerResults,
  type EtfScreenerSort,
} from "@/domainBff/etfScreener/etfScreener.client.js";
import type {
  EtfColumnRef,
  EtfFieldCatalog,
  EtfScreenerFilter,
  EtfScreenerResult,
} from "@/domainBff/etfScreener/etfScreener.types.js";

export async function getEtfFieldCatalog(): Promise<EtfFieldCatalog> {
  return fetchEtfFieldCatalog();
}

/**
 * Screens ETFs by analysis-ts's filter/column catalog — the actual query runs entirely on analysis-ts's
 * side (see etfScreener.client.ts), this function's only job is the local fast-fail below (matching
 * analysis-ts's own "filters or columns must have at least one item" rule, verified live).
 */
export async function runEtfScreener(
  filters: EtfScreenerFilter[],
  columns: EtfColumnRef[],
  page: number,
  pageSize: number,
  sort?: EtfScreenerSort,
): Promise<EtfScreenerResult> {
  if (filters.length === 0 && columns.length === 0) {
    throw new AppError('"filters" or "columns" must have at least one item', 400);
  }
  return fetchEtfScreenerResults(filters, columns, page, pageSize, sort);
}
