import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../domains/columnPresetTemplates/columnPresetTemplates.repository.js", () => ({
  findColumnPresetTemplate: vi.fn(),
  listColumnPresetTemplates: vi.fn(),
  replaceColumnPresetTemplates: vi.fn(),
}));

vi.mock("../domains/columnPresetTemplates/columnPresetTemplates.client.js", () => ({
  fetchColumnPresetTemplates: vi.fn(),
}));

vi.mock("../domains/screener/columnPresets.service.js", () => ({
  addColumnPresetWithName: vi.fn(),
}));

import { addColumnPresetWithName } from "../domains/screener/columnPresets.service.js";
import { fetchColumnPresetTemplates } from "../domains/columnPresetTemplates/columnPresetTemplates.client.js";
import {
  findColumnPresetTemplate,
  listColumnPresetTemplates,
  replaceColumnPresetTemplates,
} from "../domains/columnPresetTemplates/columnPresetTemplates.repository.js";
import {
  applyColumnPresetTemplate,
  getColumnPresetTemplateOrThrow,
  getColumnPresetTemplates,
  syncColumnPresetTemplates,
} from "../domains/columnPresetTemplates/columnPresetTemplates.service.js";

const PROFITABILITY_QUALITY_TEMPLATE = {
  key: "profitabilityQuality",
  name: "獲利品質拆解",
  description: "杜邦拆解 ROE 的驅動來源，搭配現金流有沒有真的支撐帳面獲利，判斷獲利是不是虛的",
  fieldKeys: [
    "dupont.netProfitMarginQuarterly",
    "dupont.assetTurnoverQuarterly",
    "dupont.equityMultiplier",
    "dupont.decomposedRoeQuarterlyPct",
    "ocfToNetIncome.ocfToNetIncomeQuarterly",
    "accrualsRatio.accrualsRatioQuarterly",
  ],
};

beforeEach(() => {
  vi.mocked(listColumnPresetTemplates).mockReset();
  vi.mocked(findColumnPresetTemplate).mockReset();
  vi.mocked(replaceColumnPresetTemplates).mockReset();
  vi.mocked(fetchColumnPresetTemplates).mockReset();
  vi.mocked(addColumnPresetWithName).mockReset();
});

describe("getColumnPresetTemplates", () => {
  it("returns whatever the repository lists", async () => {
    vi.mocked(listColumnPresetTemplates).mockResolvedValue([PROFITABILITY_QUALITY_TEMPLATE]);
    await expect(getColumnPresetTemplates()).resolves.toEqual([PROFITABILITY_QUALITY_TEMPLATE]);
  });
});

describe("getColumnPresetTemplateOrThrow", () => {
  it("throws 404 when not found", async () => {
    vi.mocked(findColumnPresetTemplate).mockResolvedValue(null);
    await expect(getColumnPresetTemplateOrThrow("missing")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("returns the template when found", async () => {
    vi.mocked(findColumnPresetTemplate).mockResolvedValue(PROFITABILITY_QUALITY_TEMPLATE);
    await expect(getColumnPresetTemplateOrThrow("profitabilityQuality")).resolves.toEqual(
      PROFITABILITY_QUALITY_TEMPLATE,
    );
  });
});

describe("applyColumnPresetTemplate", () => {
  it("throws 404 when the template doesn't exist", async () => {
    vi.mocked(findColumnPresetTemplate).mockResolvedValue(null);
    await expect(applyColumnPresetTemplate("uid1", "missing")).rejects.toMatchObject({ statusCode: 404 });
    expect(addColumnPresetWithName).not.toHaveBeenCalled();
  });

  it("clones a template's fieldKeys into a new column preset named after the template", async () => {
    vi.mocked(findColumnPresetTemplate).mockResolvedValue(PROFITABILITY_QUALITY_TEMPLATE);
    const created = { id: "new-preset-id", name: PROFITABILITY_QUALITY_TEMPLATE.name } as never;
    vi.mocked(addColumnPresetWithName).mockResolvedValue(created);

    const result = await applyColumnPresetTemplate("uid1", "profitabilityQuality");

    expect(addColumnPresetWithName).toHaveBeenCalledWith(
      "uid1",
      PROFITABILITY_QUALITY_TEMPLATE.name,
      PROFITABILITY_QUALITY_TEMPLATE.fieldKeys,
    );
    expect(result).toBe(created);
  });
});

describe("syncColumnPresetTemplates", () => {
  it("fetches from the client and replaces the stored templates", async () => {
    vi.mocked(fetchColumnPresetTemplates).mockResolvedValue([PROFITABILITY_QUALITY_TEMPLATE]);
    vi.mocked(replaceColumnPresetTemplates).mockResolvedValue(undefined);

    const summary = await syncColumnPresetTemplates();

    expect(replaceColumnPresetTemplates).toHaveBeenCalledWith([PROFITABILITY_QUALITY_TEMPLATE]);
    expect(summary).toEqual({ templateCount: 1 });
  });
});
