import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/domains/presetTemplates/presetTemplates.repository.js", () => ({
  findPresetTemplate: vi.fn(),
  listPresetTemplates: vi.fn(),
}));

vi.mock("@/domains/screener/screenerPresets.service.js", () => ({
  addPresetWithName: vi.fn(),
}));

import { addPresetWithName } from "@/domains/screener/screenerPresets.service.js";
import {
  findPresetTemplate,
  listPresetTemplates,
} from "@/domains/presetTemplates/presetTemplates.repository.js";
import {
  applyPresetTemplate,
  getPresetTemplateOrThrow,
  getPresetTemplates,
} from "@/domains/presetTemplates/presetTemplates.service.js";

const AVAILABLE_TEMPLATE = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  name: "巴菲特護城河",
  category: "大師策略",
  description: "test",
  tier: "FREE" as const,
  status: "AVAILABLE" as const,
  pendingReason: null,
  filters: [{ field: "roe.roeTtmPct", min: 15, max: null, exclude: false }],
  createdAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-30T00:00:00.000Z",
};

const PENDING_TEMPLATE = {
  ...AVAILABLE_TEMPLATE,
  id: "aaaaaaaa-0000-4000-8000-000000000002",
  name: "Magic Formula 神奇公式",
  status: "PENDING" as const,
  pendingReason: "需要排名/合併計分機制，目前 screener 不支援。",
  filters: [],
};

beforeEach(() => {
  vi.mocked(listPresetTemplates).mockReset();
  vi.mocked(findPresetTemplate).mockReset();
  vi.mocked(addPresetWithName).mockReset();
});

describe("getPresetTemplates", () => {
  it("returns whatever the repository lists, unfiltered by tier", async () => {
    vi.mocked(listPresetTemplates).mockResolvedValue([AVAILABLE_TEMPLATE, PENDING_TEMPLATE]);
    await expect(getPresetTemplates()).resolves.toEqual([AVAILABLE_TEMPLATE, PENDING_TEMPLATE]);
  });
});

describe("getPresetTemplateOrThrow", () => {
  it("throws 404 when not found", async () => {
    vi.mocked(findPresetTemplate).mockResolvedValue(null);
    await expect(getPresetTemplateOrThrow("missing-uuid")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("returns the template when found", async () => {
    vi.mocked(findPresetTemplate).mockResolvedValue(AVAILABLE_TEMPLATE);
    await expect(getPresetTemplateOrThrow(AVAILABLE_TEMPLATE.id)).resolves.toEqual(AVAILABLE_TEMPLATE);
  });
});

describe("applyPresetTemplate", () => {
  it("throws 404 when the template doesn't exist", async () => {
    vi.mocked(findPresetTemplate).mockResolvedValue(null);
    await expect(applyPresetTemplate("uid1", "missing-uuid")).rejects.toMatchObject({ statusCode: 404 });
    expect(addPresetWithName).not.toHaveBeenCalled();
  });

  // Regression-shaped test: a PENDING template has no real filters (see seedPresetTemplates.ts) — cloning
  // it would silently create either an empty preset or one referencing a metric this ecosystem doesn't
  // compute, so applying it must be rejected instead of quietly "succeeding" with something broken.
  it("rejects applying a PENDING template with a 409 that includes the pendingReason", async () => {
    vi.mocked(findPresetTemplate).mockResolvedValue(PENDING_TEMPLATE);
    await expect(applyPresetTemplate("uid1", PENDING_TEMPLATE.id)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining(PENDING_TEMPLATE.pendingReason),
    });
    expect(addPresetWithName).not.toHaveBeenCalled();
  });

  it("clones an AVAILABLE template's filters into a new preset named after the template", async () => {
    vi.mocked(findPresetTemplate).mockResolvedValue(AVAILABLE_TEMPLATE);
    const created = { id: "new-preset-id", name: AVAILABLE_TEMPLATE.name } as never;
    vi.mocked(addPresetWithName).mockResolvedValue(created);

    const result = await applyPresetTemplate("uid1", AVAILABLE_TEMPLATE.id);

    expect(addPresetWithName).toHaveBeenCalledWith("uid1", AVAILABLE_TEMPLATE.name, AVAILABLE_TEMPLATE.filters);
    expect(result).toBe(created);
  });
});
