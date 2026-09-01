import { Router } from "ultimate-express";
import { columnPresetTemplatesRouter } from "../columnPresetTemplates/index.js";
import { presetTemplatesRouter } from "../presetTemplates/index.js";
import { columnPresetsRouter } from "./columnPresets.routes.js";
import { screenerRouter } from "./screener.routes.js";
import { screenerPresetsRouter } from "./screenerPresets.routes.js";

export const screenerRoutes = Router();
screenerRoutes.use("/column-presets", columnPresetsRouter);
screenerRoutes.use("/column-preset-templates", columnPresetTemplatesRouter);
screenerRoutes.use("/presets", screenerPresetsRouter);
screenerRoutes.use("/templates", presetTemplatesRouter);
screenerRoutes.use("/", screenerRouter);

export { runRanking, runScreener } from "./screener.service.js";
export type { RankingResult } from "./screener.service.js";
export {
  addColumnPreset,
  addColumnPresetWithName,
  editColumnPreset,
  getColumnPresetOrThrow,
  getColumnPresets,
  removeColumnPreset,
  resolveScreenerColumns,
} from "./columnPresets.service.js";
export { addPreset, editPreset, getPresetOrThrow, getPresets, removePreset, runPreset } from "./screenerPresets.service.js";
export type { ScreenerColumnRef, ScreenerFilter, ScreenerResult, ScreenerResultColumn, ScreenerResultRow } from "./screener.types.js";
export type { ColumnPresetColumnView, ColumnPresetView } from "./columnPresets.service.js";
export type { PresetFilterView, PresetView } from "./screenerPresets.service.js";
