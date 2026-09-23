import { Router } from "ultimate-express";
import { columnPresetTemplatesRouter } from "@/http/modules/columnPresetTemplates/route.js";
import { presetTemplatesRouter } from "@/http/modules/presetTemplates/route.js";
import { columnPresetsRouter } from "@/http/modules/columnPresets/route.js";
import { screenerRouter } from "@/http/modules/screener/route.js";
import { screenerPresetsRouter } from "@/http/modules/screenerPresets/route.js";

export const screenerRoutes = Router();
screenerRoutes.use("/column-presets", columnPresetsRouter);
screenerRoutes.use("/column-preset-templates", columnPresetTemplatesRouter);
screenerRoutes.use("/presets", screenerPresetsRouter);
screenerRoutes.use("/templates", presetTemplatesRouter);
screenerRoutes.use("/", screenerRouter);

export { runRanking, runScreener } from "@/application/proxy/screener/screener.service.js";
export type { RankingResult } from "@/application/proxy/screener/screener.service.js";
export {
  addColumnPreset,
  addColumnPresetWithName,
  editColumnPreset,
  getColumnPresetOrThrow,
  getColumnPresets,
  removeColumnPreset,
  resolveScreenerColumns,
} from "@/application/screener/columnPresets.service.js";
export { addPreset, editPreset, getPresetOrThrow, getPresets, removePreset } from "@/application/screener/screenerPresets.service.js";
export { runPreset } from "@/application/proxy/screener/runPreset.js";
export type { ScreenerColumnRef, ScreenerFilter, ScreenerResult, ScreenerResultColumn, ScreenerResultRow } from "@/application/proxy/screener/screener.types.js";
export type { ColumnPresetColumnView, ColumnPresetView } from "@/application/screener/columnPresets.service.js";
export type { PresetFilterView, PresetView } from "@/application/screener/screenerPresets.service.js";
