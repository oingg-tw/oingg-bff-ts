import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../domains/filterCatalog/index.js", () => ({
  findFilterField: vi.fn(),
}));

vi.mock("../domains/screener/screenerPresets.repository.js", () => ({
  createPreset: vi.fn(),
  deletePreset: vi.fn(),
  findPreset: vi.fn(),
  listPresets: vi.fn(),
  setLastColumnPreset: vi.fn(),
  updatePreset: vi.fn(),
}));

vi.mock("../domains/screener/screener.service.js", () => ({
  runScreener: vi.fn(),
}));

vi.mock("../domains/screener/columnPresets.service.js", () => ({
  ensureDefaultColumnPreset: vi.fn(),
  resolveScreenerColumns: vi.fn(),
}));

import { Prisma } from "../generated/prisma/client.js";
import { findFilterField } from "../domains/filterCatalog/index.js";
import { ensureDefaultColumnPreset, resolveScreenerColumns } from "../domains/screener/columnPresets.service.js";
import { runScreener } from "../domains/screener/screener.service.js";
import {
  createPreset,
  deletePreset,
  findPreset,
  setLastColumnPreset,
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
  lastColumnPresetId: null,
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
  vi.mocked(setLastColumnPreset).mockReset();
  vi.mocked(runScreener).mockReset();
  vi.mocked(resolveScreenerColumns).mockReset();
  vi.mocked(ensureDefaultColumnPreset).mockReset();
  vi.mocked(ensureDefaultColumnPreset).mockResolvedValue(null);
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

  it("auto-assigns the user's default column preset to a freshly created preset", async () => {
    vi.mocked(createPreset).mockResolvedValue(SAMPLE_ROW);
    vi.mocked(ensureDefaultColumnPreset).mockResolvedValue({
      id: 42,
      name: "常用欄位",
      isDefault: true,
      columns: [],
      createdAt: "2026-08-28T00:00:00.000Z",
      updatedAt: "2026-08-28T00:00:00.000Z",
    });

    const result = await addPreset("uid1", "績優股", []);

    expect(ensureDefaultColumnPreset).toHaveBeenCalledWith("uid1");
    expect(setLastColumnPreset).toHaveBeenCalledWith("uid1", SAMPLE_ROW.id, 42);
    expect(result.lastColumnPresetId).toBe(42);
  });

  it("still succeeds if auto-assigning a default column preset fails (e.g. a name conflict)", async () => {
    vi.mocked(createPreset).mockResolvedValue(SAMPLE_ROW);
    vi.mocked(ensureDefaultColumnPreset).mockResolvedValue(null);

    const result = await addPreset("uid1", "績優股", []);

    expect(setLastColumnPreset).not.toHaveBeenCalled();
    expect(result.id).toBe(SAMPLE_ROW.id);
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

const SAMPLE_SCREENER_RESULT = {
  count: 1,
  columns: [{ field: "marketRatios.peRatio", metricName: "Market Ratios", fieldName: "PER" }],
  results: [{ symbol: "2330", values: { "marketRatios.peRatio": "27.82" } }],
};

describe("runPreset", () => {
  it("throws 404 when the preset doesn't exist for this user", async () => {
    vi.mocked(findPreset).mockResolvedValue(null);
    await expect(runPreset("uid1", 999)).rejects.toMatchObject({ statusCode: 404 });
    expect(runScreener).not.toHaveBeenCalled();
  });

  it("with no columnPresetId and no last-used one, resolves columns with undefined (falls to user default/system default)", async () => {
    vi.mocked(findPreset).mockResolvedValue(SAMPLE_ROW);
    vi.mocked(resolveScreenerColumns).mockResolvedValue({
      columnPresetId: null,
      columns: [{ field: "marketRatios.peRatio" }],
    });
    vi.mocked(runScreener).mockResolvedValue(SAMPLE_SCREENER_RESULT);

    const result = await runPreset("uid1", 1);

    expect(resolveScreenerColumns).toHaveBeenCalledWith("uid1", undefined);
    expect(setLastColumnPreset).not.toHaveBeenCalled();
    expect(runScreener).toHaveBeenCalledWith(
      [
        { field: "roe.roeTtmPct", min: 30, max: null, exclude: false },
        { field: "margins.grossMarginTtm", min: 60, max: null, exclude: false },
      ],
      [{ field: "marketRatios.peRatio" }],
    );
    expect(result.preset.name).toBe("績優股");
    expect(result.columnPresetId).toBeNull();
  });

  it("with no explicit columnPresetId, falls back to the preset's last-used column preset", async () => {
    vi.mocked(findPreset).mockResolvedValue({ ...SAMPLE_ROW, lastColumnPresetId: 7 });
    vi.mocked(resolveScreenerColumns).mockResolvedValue({ columnPresetId: 7, columns: [] });
    vi.mocked(runScreener).mockResolvedValue(SAMPLE_SCREENER_RESULT);

    await runPreset("uid1", 1);

    expect(resolveScreenerColumns).toHaveBeenCalledWith("uid1", 7);
    expect(setLastColumnPreset).not.toHaveBeenCalled();
  });

  it("with an explicit columnPresetId, uses it and remembers it as the preset's new last-used column preset", async () => {
    vi.mocked(findPreset).mockResolvedValue({ ...SAMPLE_ROW, lastColumnPresetId: 7 });
    vi.mocked(resolveScreenerColumns).mockResolvedValue({ columnPresetId: 9, columns: [] });
    vi.mocked(runScreener).mockResolvedValue(SAMPLE_SCREENER_RESULT);

    const result = await runPreset("uid1", 1, 9);

    expect(resolveScreenerColumns).toHaveBeenCalledWith("uid1", 9);
    expect(setLastColumnPreset).toHaveBeenCalledWith("uid1", 1, 9);
    expect(result.columnPresetId).toBe(9);
  });
});
