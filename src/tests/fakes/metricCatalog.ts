import { vi } from "vitest";
import type { MetricCatalogPort } from "@/application/ports/metricCatalog.js";
import type { MetricFieldLookup, MetricFieldRef } from "@/application/metricCatalog/metricCatalog.types.js";

/**
 * A typed fake of MetricCatalogPort. Shared by every slice that validates a field reference against the
 * synced catalog — the screener proxy, both preset services, and both template services.
 *
 * Defaults are "the catalog is empty", i.e. every field is unknown. Most tests override `findFields`
 * with their own tiny catalog; `fakeCatalogLookup` below builds one from a plain map so they don't each
 * hand-roll the same "look it up by metricKey.fieldKey, drop the misses" implementation.
 */
export function fakeMetricCatalog(overrides: Partial<MetricCatalogPort> = {}): MetricCatalogPort {
  return {
    list: vi.fn().mockResolvedValue([]),
    replace: vi.fn().mockResolvedValue(undefined),
    findFields: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

/**
 * Builds a findFields implementation over a `"metricKey.fieldKey" -> lookup` map, returning only the
 * refs that are in it — the same "only what was found, caller compares against what it asked for"
 * contract the real port has, which is what makes the unknown-field 400 paths testable.
 */
export function fakeCatalogLookup(
  known: Record<string, MetricFieldLookup>,
): (refs: MetricFieldRef[]) => Promise<MetricFieldLookup[]> {
  return async (refs) =>
    refs
      .map((ref) => known[`${ref.metricKey}.${ref.fieldKey}`])
      .filter((f): f is MetricFieldLookup => f !== undefined);
}
