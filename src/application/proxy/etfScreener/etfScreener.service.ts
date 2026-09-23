import { AppError } from "@/domain/appError.js";
import type { AppDeps } from "@/application/deps.js";
import type {
  EtfColumnRef,
  EtfScreenerFilter,
  EtfScreenerResult,
  EtfScreenerSort,
} from "@/application/proxy/etfScreener/etfScreener.types.js";

/**
 * Only the one gateway: this slice owns no data of its own. Taken as the LAST argument, same convention
 * as the 業務中台 services.
 */
export type EtfScreenerDeps = Pick<AppDeps, "etfScreenerGateway">;

/**
 * Screens ETFs by analysis-ts's filter/column catalog — the actual query runs entirely on analysis-ts's
 * side (see etfScreener.client.ts), this function's only job is the local fast-fail below (matching
 * analysis-ts's own "filters or columns must have at least one item" rule, verified live).
 *
 * This is also why the slice still has a service file at all while its sibling getEtfFieldCatalog does
 * not: that one had nothing to check, so the route calls the gateway port directly for it.
 */
export async function runEtfScreener(
  filters: EtfScreenerFilter[],
  columns: EtfColumnRef[],
  page: number,
  pageSize: number,
  sort: EtfScreenerSort | undefined,
  deps: EtfScreenerDeps,
): Promise<EtfScreenerResult> {
  if (filters.length === 0 && columns.length === 0) {
    throw new AppError('"filters" or "columns" must have at least one item', 400);
  }
  return deps.etfScreenerGateway.runScreener(filters, columns, page, pageSize, sort);
}
