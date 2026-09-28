import { vi } from "vitest";
import type { ColumnPresetsPort } from "@/application/ports/columnPresets.js";

/**
 * A typed fake of ColumnPresetsPort — see fakes/screenerPresets.ts for why these live in their own
 * files rather than inline in each test.
 *
 * Defaults are "this user has no column presets saved"; each test overrides only what it exercises.
 */
export function fakeColumnPresets(overrides: Partial<ColumnPresetsPort> = {}): ColumnPresetsPort {
  return {
    list: vi.fn().mockResolvedValue([]),
    find: vi.fn().mockResolvedValue(null),
    findByName: vi.fn().mockResolvedValue(null),
    findDefault: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn().mockResolvedValue(true),
    reorder: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}
