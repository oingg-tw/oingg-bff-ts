import { Router } from "ultimate-express";
import { presetTemplatesRouter } from "../presetTemplates/index.js";
import { columnPresetsRouter } from "./columnPresets.routes.js";
import { displaySettingsRouter } from "./displaySettings.routes.js";
import { screenerRouter } from "./screener.routes.js";
import { screenerPresetsRouter } from "./screenerPresets.routes.js";

export const screenerRoutes = Router();
screenerRoutes.use("/column-presets", columnPresetsRouter);
screenerRoutes.use("/presets", screenerPresetsRouter);
screenerRoutes.use("/templates", presetTemplatesRouter);
screenerRoutes.use("/display-settings", displaySettingsRouter);
screenerRoutes.use("/", screenerRouter);

export { runRanking, runScreener } from "./screener.service.js";
export type { RankingResult } from "./screener.service.js";
export {
  addColumnPreset,
  editColumnPreset,
  getColumnPresetOrThrow,
  getColumnPresets,
  removeColumnPreset,
  resolveScreenerColumns,
  SYSTEM_DEFAULT_COLUMNS,
} from "./columnPresets.service.js";
export { addPreset, editPreset, getPresetOrThrow, getPresets, removePreset, runPreset } from "./screenerPresets.service.js";
export type { ScreenerColumnRef, ScreenerFilter, ScreenerResult, ScreenerResultColumn, ScreenerResultRow } from "./screener.types.js";
export type { ColumnPresetColumnView, ColumnPresetView } from "./columnPresets.service.js";
export type { PresetFilterView, PresetView } from "./screenerPresets.service.js";
export { getDisplaySettings, updateShowAsOfDate, SYSTEM_DEFAULT_DISPLAY_SETTINGS } from "./displaySettings.service.js";
export type { ScreenerDisplaySettings } from "./displaySettings.types.js";
