import { vi } from "vitest";
import type { ColumnPresetTemplatesPort } from "@/application/ports/columnPresetTemplates.js";
import type { PresetTemplatesPort } from "@/application/ports/presetTemplates.js";

/**
 * Typed fakes of the two curated-template ports. They share a file because they are the same shape and
 * the same idea (read-only, no firebaseUid) and are almost always faked together — resolving a screener's
 * default columns needs ColumnPresetTemplatesPort even in tests that care about nothing else.
 *
 * Defaults are "nothing curated yet", which is also the real fallback path (see resolveDefaultColumns).
 */
export function fakePresetTemplates(overrides: Partial<PresetTemplatesPort> = {}): PresetTemplatesPort {
  return {
    list: vi.fn().mockResolvedValue([]),
    find: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

export function fakeColumnPresetTemplates(
  overrides: Partial<ColumnPresetTemplatesPort> = {},
): ColumnPresetTemplatesPort {
  return {
    list: vi.fn().mockResolvedValue([]),
    find: vi.fn().mockResolvedValue(null),
    findDefault: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}
