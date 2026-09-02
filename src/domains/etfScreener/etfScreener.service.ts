import { AppError } from "@/shared/errorHandler.js";
import {
  fetchEtfFilterCatalog,
  fetchEtfScreenerResults,
  type EtfScreenerSort,
} from "@/domains/etfScreener/etfScreener.client.js";
import type {
  EtfColumnRef,
  EtfFilterCatalog,
  EtfScreenerFilter,
  EtfScreenerResult,
} from "@/domains/etfScreener/etfScreener.types.js";

export async function getEtfFilterCatalog(): Promise<EtfFilterCatalog> {
  return fetchEtfFilterCatalog();
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
