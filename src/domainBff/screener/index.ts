import { Router } from "ultimate-express";
import { columnPresetTemplatesRouter } from "@/domainBusiness/columnPresetTemplates/index.js";
import { presetTemplatesRouter } from "@/domainBusiness/presetTemplates/index.js";
import { columnPresetsRouter } from "@/domainBusiness/screener/columnPresets.routes.js";
import { screenerRouter } from "@/domainBff/screener/screener.routes.js";
import { screenerPresetsRouter } from "@/domainBff/screener/screenerPresets.routes.js";

export const screenerRoutes = Router();
screenerRoutes.use("/column-presets", columnPresetsRouter);
screenerRoutes.use("/column-preset-templates", columnPresetTemplatesRouter);
screenerRoutes.use("/presets", screenerPresetsRouter);
screenerRoutes.use("/templates", presetTemplatesRouter);
screenerRoutes.use("/", screenerRouter);

export { runRanking, runScreener } from "@/domainBff/screener/screener.service.js";
export type { RankingResult } from "@/domainBff/screener/screener.service.js";
export {
  addColumnPreset,
  addColumnPresetWithName,
  editColumnPreset,
  getColumnPresetOrThrow,
  getColumnPresets,
  removeColumnPreset,
  resolveScreenerColumns,
} from "@/domainBusiness/screener/columnPresets.service.js";
export { addPreset, editPreset, getPresetOrThrow, getPresets, removePreset } from "@/domainBusiness/screener/screenerPresets.service.js";
export { runPreset } from "@/domainBff/screener/runPreset.js";
export type { ScreenerColumnRef, ScreenerFilter, ScreenerResult, ScreenerResultColumn, ScreenerResultRow } from "@/domainBff/screener/screener.types.js";
export type { ColumnPresetColumnView, ColumnPresetView } from "@/domainBusiness/screener/columnPresets.service.js";
export type { PresetFilterView, PresetView } from "@/domainBusiness/screener/screenerPresets.service.js";
