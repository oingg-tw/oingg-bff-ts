import { Router } from "ultimate-express";
import { columnPresetsRouter } from "./columnPresets.routes.js";
import { screenerRouter } from "./screener.routes.js";
import { screenerPresetsRouter } from "./screenerPresets.routes.js";

export const screenerRoutes = Router();
screenerRoutes.use("/column-presets", columnPresetsRouter);
screenerRoutes.use("/presets", screenerPresetsRouter);
screenerRoutes.use("/", screenerRouter);

export { runScreener } from "./screener.service.js";
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
