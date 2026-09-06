import type { ScreenerSort } from "@/domains/screener/analysisScreenerClient.js";
import { resolveScreenerColumns, type ResolvedScreenerColumns } from "@/domains/screener/columnPresets.service.js";
import type { Pagination } from "@/domains/screener/pagination.js";
import { runScreener } from "@/domains/screener/screener.service.js";
import type { ScreenerResult } from "@/domains/screener/screener.types.js";
import {
  getPresetOrThrow,
  updateLastColumnPreset,
  type PresetView,
} from "@/domains/screener/screenerPresets.service.js";

/**
 * Re-runs a saved preset's filters and returns both the filter definition and the matching stocks.
 *
 * Deliberately kept outside screenerPresets.service.ts (which owns nothing but the ScreenerPreset CRUD):
 * running a preset means executing the same query engine as the ad-hoc screener (runScreener), which is
 * this BFF's job, not the preset-storage domain's — see the BFF/業務中台 module split. This function is the
 * one place that's allowed to depend on both sides.
 *
 * Column resolution order: an explicit `columnPresetId` (and when given, it's saved as this preset's
 * new "last viewed with" column preset, i.e. switching columns sticks for next time) → else the column
 * preset this filter combo was last viewed with → else the user's own default column preset → else the
 * hardcoded system default.
 *
 * Perf (2026-09-01): when `columnPresetId` is given explicitly, resolving it doesn't need
 * `preset.lastColumnPresetId` at all — getPresetOrThrow and resolveScreenerColumns are independent
 * lookups against the same remote DB in that case, so they run concurrently instead of paying two
 * sequential round trips. Only the no-explicit-columnPresetId path genuinely needs the preset's result
 * first. updateLastColumnPreset is also skipped when nothing actually changed — every "same
 * columnPresetId as last time" call (e.g. paging through the same view) used to fire a write that
 * changed nothing.
 */
export async function runPreset(
  firebaseUid: string,
  id: string,
  pagination: Pagination,
  columnPresetId?: string,
  sort?: ScreenerSort,
): Promise<{ preset: PresetView; screener: ScreenerResult; columnPresetId: string | null }> {
  let preset: PresetView;
  let resolved: ResolvedScreenerColumns;

  if (columnPresetId !== undefined) {
    [preset, resolved] = await Promise.all([
      getPresetOrThrow(firebaseUid, id),
      resolveScreenerColumns(firebaseUid, columnPresetId),
    ]);
  } else {
    preset = await getPresetOrThrow(firebaseUid, id);
    resolved = await resolveScreenerColumns(firebaseUid, preset.lastColumnPresetId ?? undefined);
  }

  if (columnPresetId !== undefined && resolved.columnPresetId !== preset.lastColumnPresetId) {
    await updateLastColumnPreset(firebaseUid, id, resolved.columnPresetId ?? columnPresetId);
  }

  const screener = await runScreener(preset.filters, resolved.columns, pagination, sort);
  return { preset, screener, columnPresetId: resolved.columnPresetId };
}
