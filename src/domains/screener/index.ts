import { Router } from "ultimate-express";
import { columnPresetTemplatesRouter } from "@/domains/columnPresetTemplates/index.js";
import { presetTemplatesRouter } from "@/domains/presetTemplates/index.js";
import { columnPresetsRouter } from "@/domains/screener/columnPresets.routes.js";
import { screenerRouter } from "@/domains/screener/screener.routes.js";
import { screenerPresetsRouter } from "@/domains/screener/screenerPresets.routes.js";

export const screenerRoutes = Router();
screenerRoutes.use("/column-presets", columnPresetsRouter);
screenerRoutes.use("/column-preset-templates", columnPresetTemplatesRouter);
screenerRoutes.use("/presets", screenerPresetsRouter);
screenerRoutes.use("/templates", presetTemplatesRouter);
screenerRoutes.use("/", screenerRouter);

export { runRanking, runScreener } from "@/domains/screener/screener.service.js";
export type { RankingResult } from "@/domains/screener/screener.service.js";
export {
  addColumnPreset,
  addColumnPresetWithName,
  editColumnPreset,
  getColumnPresetOrThrow,
  getColumnPresets,
  removeColumnPreset,
  resolveScreenerColumns,
} from "@/domains/screener/columnPresets.service.js";
export { addPreset, editPreset, getPresetOrThrow, getPresets, removePreset, runPreset } from "@/domains/screener/screenerPresets.service.js";
export type { ScreenerColumnRef, ScreenerFilter, ScreenerResult, ScreenerResultColumn, ScreenerResultRow } from "@/domains/screener/screener.types.js";
export type { ColumnPresetColumnView, ColumnPresetView } from "@/domains/screener/columnPresets.service.js";
export type { PresetFilterView, PresetView } from "@/domains/screener/screenerPresets.service.js";
