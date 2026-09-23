import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/prisma/repositories/metricCatalog.repository.js", () => ({
  findMetricFields: vi.fn(),
}));

import { findMetricFields } from "@/infrastructure/prisma/repositories/metricCatalog.repository.js";
import { fakeColumnPresets } from "@/tests/fakes/columnPresets.js";
import { fakeColumnPresetTemplates } from "@/tests/fakes/presetTemplates.js";
import {
  applyColumnPresetTemplate,
  getColumnPresetTemplateOrThrow,
  getColumnPresetTemplates,
} from "@/application/columnPresetTemplates/columnPresetTemplates.service.js";

const PROFITABILITY_QUALITY_TEMPLATE = {
  key: "profitabilityQuality",
  name: "獲利品質拆解",
  description: "杜邦拆解 ROE 的驅動來源，搭配現金流有沒有真的支撐帳面獲利，判斷獲利是不是虛的",
  fieldKeys: ["dupont.equityMultiplier", "ocfToNetIncome.ocfToNetIncomeQuarterly"],
  isDefault: false,
};

const CREATED_ROW = {
  id: "bbbbbbbb-0000-4000-8000-000000000001",
  name: PROFITABILITY_QUALITY_TEMPLATE.name,
  isDefault: false,
  columns: PROFITABILITY_QUALITY_TEMPLATE.fieldKeys,
  createdAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-30T00:00:00.000Z",
};

beforeEach(() => {
  vi.mocked(findMetricFields).mockReset();
  // Every field the template references resolves — the "a template references a dropped field" case is
  // covered in columnPresets.service.test.ts, where the dropping rule actually lives.
  vi.mocked(findMetricFields).mockImplementation(async (refs) =>
    refs.map((ref) => ({
      categoryKey: "profitability",
      metricKey: ref.metricKey,
      metricName: ref.metricKey,
      fieldKey: ref.fieldKey,
      fieldName: ref.fieldKey,
      period: "quarterly",
      unit: null,
    })),
  );
});

describe("getColumnPresetTemplates", () => {
  it("returns whatever the port lists", async () => {
    const columnPresetTemplates = fakeColumnPresetTemplates({
      list: vi.fn().mockResolvedValue([PROFITABILITY_QUALITY_TEMPLATE]),
    });

    await expect(
      getColumnPresetTemplates({ columnPresetTemplates, columnPresets: fakeColumnPresets() }),
    ).resolves.toEqual([PROFITABILITY_QUALITY_TEMPLATE]);
  });
});

describe("getColumnPresetTemplateOrThrow", () => {
  it("throws 404 when not found", async () => {
    const deps = { columnPresetTemplates: fakeColumnPresetTemplates(), columnPresets: fakeColumnPresets() };
    await expect(getColumnPresetTemplateOrThrow("missing", deps)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("returns the template when found", async () => {
    const deps = {
      columnPresetTemplates: fakeColumnPresetTemplates({
        find: vi.fn().mockResolvedValue(PROFITABILITY_QUALITY_TEMPLATE),
      }),
      columnPresets: fakeColumnPresets(),
    };
    await expect(getColumnPresetTemplateOrThrow("profitabilityQuality", deps)).resolves.toEqual(
      PROFITABILITY_QUALITY_TEMPLATE,
    );
  });
});

describe("applyColumnPresetTemplate", () => {
  it("throws 404 when the template doesn't exist", async () => {
    const columnPresets = fakeColumnPresets();

    await expect(
      applyColumnPresetTemplate("uid1", "missing", {
        columnPresetTemplates: fakeColumnPresetTemplates(),
        columnPresets,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(columnPresets.create).not.toHaveBeenCalled();
  });

  // Goes through the real addColumnPresetWithName rather than stubbing it out: what matters is that
  // applying a template ends up *storing a column preset named after the template*, which is only
  // visible at the port.
  it("clones a template's fieldKeys into a new column preset named after the template", async () => {
    const columnPresets = fakeColumnPresets({ create: vi.fn().mockResolvedValue({ ok: true, row: CREATED_ROW }) });
    const columnPresetTemplates = fakeColumnPresetTemplates({
      find: vi.fn().mockResolvedValue(PROFITABILITY_QUALITY_TEMPLATE),
    });

    const result = await applyColumnPresetTemplate("uid1", "profitabilityQuality", {
      columnPresetTemplates,
      columnPresets,
    });

    expect(columnPresets.create).toHaveBeenCalledWith(
      "uid1",
      PROFITABILITY_QUALITY_TEMPLATE.name,
      PROFITABILITY_QUALITY_TEMPLATE.fieldKeys,
      false,
    );
    expect(result.name).toBe(PROFITABILITY_QUALITY_TEMPLATE.name);
  });
});
