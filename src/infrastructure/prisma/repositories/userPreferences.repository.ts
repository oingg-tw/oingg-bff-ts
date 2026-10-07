import { findHoldingColumns, upsertHoldingColumns } from "@/infrastructure/prisma/repositories/holdingColumns.repository.js";
import { findWatchlistColumns, upsertWatchlistColumns } from "@/infrastructure/prisma/repositories/watchlistColumns.repository.js";
import {
  findPreferredStocksPreferences,
  upsertPreferredStocksPreferences,
} from "@/infrastructure/prisma/repositories/preferredStocksPreferences.repository.js";
import {
  findDisplaySettings,
  upsertDisplaySettings,
} from "@/infrastructure/prisma/repositories/screenerDisplaySettings.repository.js";
import { findThemePreference, upsertThemePreference } from "@/infrastructure/prisma/repositories/theme.repository.js";
import type { UserPreferencesPort } from "@/application/ports/userPreferences.js";

/**
 * UserPreferencesPort 的 Prisma 實作。
 *
 * 一個 port 對應五張表，所以實作也擺在一個檔案裡：把 port 的方法名對回各表的 repository 函式，一眼就
 * 看得完整張對照表。五個 repository 檔案維持原樣不動，因為每張表的 select/upsert 細節（例如 Json 欄位
 * 的轉型）本來就是各自的事。
 *
 * 這裡沒有任何錯誤翻譯——五張表都是以 firebaseUid 為唯一鍵的 upsert，不會撞 unique violation，所以不像
 * WatchlistPort/HoldingsPort 需要把 P2002 翻成領域語彙。哪天多了第二個唯一鍵，翻譯要加在這一層。
 */
export const prismaUserPreferences: UserPreferencesPort = {
  getTheme: findThemePreference,
  saveTheme: upsertThemePreference,

  getScreenerDisplaySettings: findDisplaySettings,
  saveScreenerDisplaySettings: upsertDisplaySettings,



  getHoldingColumns: findHoldingColumns,
  saveHoldingColumns: upsertHoldingColumns,

  getWatchlistColumns: findWatchlistColumns,
  saveWatchlistColumns: upsertWatchlistColumns,

  getPreferredStocksPreferences: findPreferredStocksPreferences,
  savePreferredStocksPreferences: upsertPreferredStocksPreferences,
};
