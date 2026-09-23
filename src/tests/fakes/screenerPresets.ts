import { vi } from "vitest";
import type { ScreenerPresetsPort } from "@/application/ports/screenerPresets.js";

/**
 * A typed fake of ScreenerPresetsPort, shared by the three test files that exercise saved filter presets
 * (the slice's own service, applying a PresetTemplate, and running a preset).
 *
 * It lives in its own file for the same reason fakeUserPreferences does: one port, several use cases.
 * Being typed as the port is the point — add a method to ScreenerPresetsPort and this file stops
 * compiling, rather than the tests quietly passing against a shape that no longer exists.
 *
 * The defaults are the "this user has nothing saved, and every write succeeds" state; each test
 * overrides only the method it exercises.
 */
export function fakeScreenerPresets(overrides: Partial<ScreenerPresetsPort> = {}): ScreenerPresetsPort {
  return {
    list: vi.fn().mockResolvedValue([]),
    find: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn().mockResolvedValue(true),
    reorder: vi.fn().mockResolvedValue([]),
    setLastColumnPreset: vi.fn().mockResolvedValue(undefined),
    count: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}
