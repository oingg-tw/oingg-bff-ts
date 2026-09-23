import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/prisma/repositories/metricCatalog.repository.js", () => ({
  findMetricFields: vi.fn(),
}));

import { findMetricFields } from "@/infrastructure/prisma/repositories/metricCatalog.repository.js";
import { fakePresetTemplates } from "@/tests/fakes/presetTemplates.js";
import { fakeScreenerPresets } from "@/tests/fakes/screenerPresets.js";
import {
  applyPresetTemplate,
  getPresetTemplateOrThrow,
  getPresetTemplates,
} from "@/application/presetTemplates/presetTemplates.service.js";

const AVAILABLE_TEMPLATE = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  name: "巴菲特護城河",
  slug: "buffett-moat",
  category: "大師策略",
  description: "test",
  tier: "FREE" as const,
  status: "AVAILABLE" as const,
  pendingReason: null,
  filters: [{ field: "roe.roeTtmPct", min: 15, max: null, exclude: false }],
  isDefault: false,
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

const CREATED_ROW = {
  id: "bbbbbbbb-0000-4000-8000-000000000001",
  name: AVAILABLE_TEMPLATE.name,
  filters: [{ metricKey: "roe", fieldKey: "roeTtmPct", min: 15, max: null, exclude: false }],
  sectorCodes: [] as string[],
  excludeSectorCodes: [] as string[],
  lastColumnPresetId: null,
  createdAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-30T00:00:00.000Z",
};

beforeEach(() => {
  vi.mocked(findMetricFields).mockReset();
  vi.mocked(findMetricFields).mockResolvedValue([
    {
      categoryKey: "profitability",
      metricKey: "roe",
      metricName: "ROE",
      fieldKey: "roeTtmPct",
      fieldName: "ROE (TTM)",
      period: "ttm",
      unit: "percent",
    },
  ]);
});

describe("getPresetTemplates", () => {
  it("returns whatever the port lists, unfiltered by tier", async () => {
    const presetTemplates = fakePresetTemplates({
      list: vi.fn().mockResolvedValue([AVAILABLE_TEMPLATE, PENDING_TEMPLATE]),
    });

    await expect(getPresetTemplates({ presetTemplates, screenerPresets: fakeScreenerPresets() })).resolves.toEqual([
      AVAILABLE_TEMPLATE,
      PENDING_TEMPLATE,
    ]);
  });
});

describe("getPresetTemplateOrThrow", () => {
  it("throws 404 when not found", async () => {
    const deps = { presetTemplates: fakePresetTemplates(), screenerPresets: fakeScreenerPresets() };
    await expect(getPresetTemplateOrThrow("missing-uuid", deps)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("returns the template when found", async () => {
    const deps = {
      presetTemplates: fakePresetTemplates({ find: vi.fn().mockResolvedValue(AVAILABLE_TEMPLATE) }),
      screenerPresets: fakeScreenerPresets(),
    };
    await expect(getPresetTemplateOrThrow(AVAILABLE_TEMPLATE.id, deps)).resolves.toEqual(AVAILABLE_TEMPLATE);
  });
});

describe("applyPresetTemplate", () => {
  it("throws 404 when the template doesn't exist", async () => {
    const screenerPresets = fakeScreenerPresets();

    await expect(
      applyPresetTemplate("uid1", "missing-uuid", { presetTemplates: fakePresetTemplates(), screenerPresets }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(screenerPresets.create).not.toHaveBeenCalled();
  });

  // Regression-shaped test: a PENDING template has no real filters (see seedPresetTemplates.ts) — cloning
  // it would silently create either an empty preset or one referencing a metric this ecosystem doesn't
  // compute, so applying it must be rejected instead of quietly "succeeding" with something broken.
  it("rejects applying a PENDING template with a 409 that includes the pendingReason", async () => {
    const screenerPresets = fakeScreenerPresets();
    const presetTemplates = fakePresetTemplates({ find: vi.fn().mockResolvedValue(PENDING_TEMPLATE) });

    await expect(
      applyPresetTemplate("uid1", PENDING_TEMPLATE.id, { presetTemplates, screenerPresets }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining(PENDING_TEMPLATE.pendingReason),
    });
    expect(screenerPresets.create).not.toHaveBeenCalled();
  });

  // Goes through the real addPresetWithName rather than stubbing it out: what matters is that applying a
  // template ends up *storing a preset named after the template*, which is only visible at the port.
  it("clones an AVAILABLE template's filters into a new preset named after the template", async () => {
    const screenerPresets = fakeScreenerPresets({ create: vi.fn().mockResolvedValue({ ok: true, row: CREATED_ROW }) });
    const presetTemplates = fakePresetTemplates({ find: vi.fn().mockResolvedValue(AVAILABLE_TEMPLATE) });

    const result = await applyPresetTemplate("uid1", AVAILABLE_TEMPLATE.id, { presetTemplates, screenerPresets });

    expect(screenerPresets.create).toHaveBeenCalledWith(
      "uid1",
      AVAILABLE_TEMPLATE.name,
      [{ metricKey: "roe", fieldKey: "roeTtmPct", min: 15, max: null, exclude: false }],
      [],
      [],
    );
    expect(result.name).toBe(AVAILABLE_TEMPLATE.name);
  });
});
