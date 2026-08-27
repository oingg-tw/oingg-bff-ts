import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../domains/filterCatalog/index.js", () => ({
  findFilterField: vi.fn(),
}));

vi.mock("../domains/screener/screenerPresets.repository.js", () => ({
  createPreset: vi.fn(),
  deletePreset: vi.fn(),
  findPreset: vi.fn(),
  listPresets: vi.fn(),
  updatePreset: vi.fn(),
}));

vi.mock("../domains/screener/screener.service.js", () => ({
  runScreener: vi.fn(),
}));

vi.mock("../domains/screener/screenerColumns.repository.js", () => ({
  listColumnPreferences: vi.fn(),
}));

import { Prisma } from "../generated/prisma/client.js";
import { findFilterField } from "../domains/filterCatalog/index.js";
import { runScreener } from "../domains/screener/screener.service.js";
import { listColumnPreferences } from "../domains/screener/screenerColumns.repository.js";
import {
  createPreset,
  deletePreset,
  findPreset,
  updatePreset,
} from "../domains/screener/screenerPresets.repository.js";
import {
  addPreset,
  editPreset,
  getPresetOrThrow,
  removePreset,
  runPreset,
} from "../domains/screener/screenerPresets.service.js";

type Lookup = Awaited<ReturnType<typeof findFilterField>>;

const ROE_FIELD: Lookup = {
  categoryKey: "profitability",
  metricKey: "roe",
  metricName: "ROE",
  fieldKey: "roeTtmPct",
  fieldName: "ROE (TTM)",
  period: "ttm",
};
const MARGIN_FIELD: Lookup = {
  categoryKey: "profitability",
  metricKey: "margins",
  metricName: "Margins",
  fieldKey: "grossMarginTtm",
  fieldName: "Gross Margin (TTM)",
  period: "ttm",
};

const SAMPLE_ROW = {
  id: 1,
  name: "績優股",
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:00:00.000Z",
  filters: [
    { metricKey: "roe", fieldKey: "roeTtmPct", min: 30, max: null, exclude: false },
    { metricKey: "margins", fieldKey: "grossMarginTtm", min: 60, max: null, exclude: false },
  ],
};

beforeEach(() => {
  vi.mocked(findFilterField).mockReset();
  vi.mocked(findFilterField).mockImplementation(async (metricKey, fieldKey) => {
    if (metricKey === "roe" && fieldKey === "roeTtmPct") return ROE_FIELD;
    if (metricKey === "margins" && fieldKey === "grossMarginTtm") return MARGIN_FIELD;
    return null;
  });
  vi.mocked(createPreset).mockReset();
  vi.mocked(updatePreset).mockReset();
  vi.mocked(findPreset).mockReset();
  vi.mocked(deletePreset).mockReset();
  vi.mocked(runScreener).mockReset();
  vi.mocked(listColumnPreferences).mockReset();
});

describe("addPreset", () => {
  it("allows an empty filter list (a preset can be created before its filters are added)", async () => {
    vi.mocked(createPreset).mockResolvedValue({ ...SAMPLE_ROW, filters: [] });

    await addPreset("uid1", "空白清單", []);

    expect(createPreset).toHaveBeenCalledWith("uid1", "空白清單", []);
  });

  it("rejects a filter whose field doesn't exist in the catalog", async () => {
    await expect(
      addPreset("uid1", "績優股", [{ field: "nope.nope", min: 1, max: null, exclude: false }]),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(createPreset).not.toHaveBeenCalled();
  });

  it("resolves each field to metricKey/fieldKey before saving", async () => {
    vi.mocked(createPreset).mockResolvedValue(SAMPLE_ROW);

    await addPreset("uid1", "績優股", [
      { field: "roe.roeTtmPct", min: 30, max: null, exclude: false },
      { field: "margins.grossMarginTtm", min: 60, max: null, exclude: false },
    ]);

    expect(createPreset).toHaveBeenCalledWith("uid1", "績優股", [
      { metricKey: "roe", fieldKey: "roeTtmPct", min: 30, max: null, exclude: false },
      { metricKey: "margins", fieldKey: "grossMarginTtm", min: 60, max: null, exclude: false },
    ]);
  });

  it("turns a duplicate preset name (Prisma P2002) into a 409", async () => {
    vi.mocked(createPreset).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      }),
    );

    await expect(
      addPreset("uid1", "績優股", [{ field: "roe.roeTtmPct", min: 30, max: null, exclude: false }]),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("editPreset", () => {
  it("allows replacing filters with an empty array", async () => {
    vi.mocked(updatePreset).mockResolvedValue({ ...SAMPLE_ROW, filters: [] });

    await editPreset("uid1", 1, { filters: [] });

    expect(updatePreset).toHaveBeenCalledWith("uid1", 1, { name: undefined, filters: [] });
  });

  it("throws 404 when the repository finds no matching row", async () => {
    vi.mocked(updatePreset).mockResolvedValue(null);
    await expect(editPreset("uid1", 999, { name: "x" })).rejects.toMatchObject({ statusCode: 404 });
  });

  it("turns a duplicate name conflict into 409", async () => {
    vi.mocked(updatePreset).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    await expect(editPreset("uid1", 1, { name: "重複" })).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("getPresetOrThrow / removePreset", () => {
  it("getPresetOrThrow throws 404 when not found", async () => {
    vi.mocked(findPreset).mockResolvedValue(null);
    await expect(getPresetOrThrow("uid1", 999)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("removePreset throws 404 when nothing was deleted", async () => {
    vi.mocked(deletePreset).mockResolvedValue(false);
    await expect(removePreset("uid1", 999)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("runPreset", () => {
  it("throws 404 when the preset doesn't exist for this user", async () => {
    vi.mocked(findPreset).mockResolvedValue(null);
    await expect(runPreset("uid1", 999)).rejects.toMatchObject({ statusCode: 404 });
    expect(runScreener).not.toHaveBeenCalled();
  });

  it("runs the screener with the preset's filters and the user's current column preferences, returning both", async () => {
    vi.mocked(findPreset).mockResolvedValue(SAMPLE_ROW);
    vi.mocked(listColumnPreferences).mockResolvedValue([{ metricKey: "marketRatios", fieldKey: "peRatio", position: 0 }]);
    vi.mocked(runScreener).mockResolvedValue({
      count: 1,
      columns: [{ field: "marketRatios.peRatio", metricName: "Market Ratios", fieldName: "PER" }],
      results: [{ symbol: "2330", values: { "marketRatios.peRatio": "27.82" } }],
    });

    const result = await runPreset("uid1", 1);

    expect(runScreener).toHaveBeenCalledWith(
      [
        { field: "roe.roeTtmPct", min: 30, max: null, exclude: false },
        { field: "margins.grossMarginTtm", min: 60, max: null, exclude: false },
      ],
      [{ field: "marketRatios.peRatio" }],
    );
    expect(result.preset.name).toBe("績優股");
    expect(result.screener.results).toEqual([{ symbol: "2330", values: { "marketRatios.peRatio": "27.82" } }]);
  });
});
