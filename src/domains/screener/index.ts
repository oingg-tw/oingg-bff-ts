import { Router } from "ultimate-express";
import { screenerRouter } from "./screener.routes.js";
import { screenerColumnsRouter } from "./screenerColumns.routes.js";

export const screenerRoutes = Router();
screenerRoutes.use("/columns", screenerColumnsRouter);
screenerRoutes.use("/", screenerRouter);

export { runScreener } from "./screener.service.js";
export { getColumnPreferences, setColumnPreferences } from "./screenerColumns.service.js";
export type { ScreenerColumnRef, ScreenerFilter, ScreenerResult, ScreenerResultColumn, ScreenerResultRow } from "./screener.types.js";
