import { vi } from "vitest";
import type { UserPreferencesPort } from "@/application/ports/userPreferences.js";

/**
 * A typed fake of UserPreferencesPort, shared by the five preference services' tests.
 *
 * It lives in its own file (rather than inline in each test, the way fakeWatchlist does) because one
 * port serves five use cases — see the port's own note on why it isn't split into five. Writing the
 * same ten `vi.fn()`s into five test files would mean five edits every time the port grows, and would
 * invite someone to reach for `vi.mock` instead. The defaults below are the "user has saved nothing"
 * state; every test overrides only the method it exercises.
 *
 * Being typed as the port is the point: it can't drift from reality unnoticed. Add a method to
 * UserPreferencesPort and this file stops compiling, instead of the tests passing against a shape that
 * no longer exists.
 */
export function fakeUserPreferences(overrides: Partial<UserPreferencesPort> = {}): UserPreferencesPort {
  return {
    getTheme: vi.fn().mockResolvedValue(null),
    saveTheme: vi.fn(),
    getScreenerDisplaySettings: vi.fn().mockResolvedValue(null),
    saveScreenerDisplaySettings: vi.fn(),
    getDashboardCards: vi.fn().mockResolvedValue(null),
    saveDashboardCards: vi.fn(),
    getStockDetailPreferences: vi.fn().mockResolvedValue(null),
    saveStockDetailPreferences: vi.fn(),
    getHoldingColumns: vi.fn().mockResolvedValue(null),
    saveHoldingColumns: vi.fn().mockImplementation(async (_uid: string, columns: unknown) => columns),
    getWatchlistColumns: vi.fn().mockResolvedValue(null),
    saveWatchlistColumns: vi.fn().mockImplementation(async (_uid: string, columns: unknown) => columns),
    getPreferredStocksPreferences: vi.fn().mockResolvedValue(null),
    savePreferredStocksPreferences: vi.fn(),
    ...overrides,
  };
}
