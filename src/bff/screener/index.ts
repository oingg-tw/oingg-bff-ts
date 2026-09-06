import { Router } from "ultimate-express";
import { columnPresetTemplatesRouter } from "@/business/columnPresetTemplates/index.js";
import { presetTemplatesRouter } from "@/business/presetTemplates/index.js";
import { columnPresetsRouter } from "@/business/screener/columnPresets.routes.js";
import { screenerRouter } from "@/bff/screener/screener.routes.js";
import { screenerPresetsRouter } from "@/bff/screener/screenerPresets.routes.js";

export const screenerRoutes = Router();
screenerRoutes.use("/column-presets", columnPresetsRouter);
screenerRoutes.use("/column-preset-templates", columnPresetTemplatesRouter);
screenerRoutes.use("/presets", screenerPresetsRouter);
screenerRoutes.use("/templates", presetTemplatesRouter);
screenerRoutes.use("/", screenerRouter);

export { runRanking, runScreener } from "@/bff/screener/screener.service.js";
export type { RankingResult } from "@/bff/screener/screener.service.js";
export {
  addColumnPreset,
  addColumnPresetWithName,
  editColumnPreset,
  getColumnPresetOrThrow,
  getColumnPresets,
  removeColumnPreset,
  resolveScreenerColumns,
} from "@/business/screener/columnPresets.service.js";
export { addPreset, editPreset, getPresetOrThrow, getPresets, removePreset } from "@/business/screener/screenerPresets.service.js";
export { runPreset } from "@/bff/screener/runPreset.js";
export type { ScreenerColumnRef, ScreenerFilter, ScreenerResult, ScreenerResultColumn, ScreenerResultRow } from "@/bff/screener/screener.types.js";
export type { ColumnPresetColumnView, ColumnPresetView } from "@/business/screener/columnPresets.service.js";
export type { PresetFilterView, PresetView } from "@/business/screener/screenerPresets.service.js";
