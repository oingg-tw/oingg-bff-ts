import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../domains/filterCatalog/index.js", () => ({
  findFilterField: vi.fn(),
}));

vi.mock("../domains/screener/columnPresets.repository.js", () => ({
  createColumnPreset: vi.fn(),
  deleteColumnPreset: vi.fn(),
  findColumnPreset: vi.fn(),
  findDefaultColumnPreset: vi.fn(),
  listColumnPresets: vi.fn(),
  updateColumnPreset: vi.fn(),
}));

import { Prisma } from "../generated/prisma/client.js";
import { findFilterField } from "../domains/filterCatalog/index.js";
import {
  createColumnPreset,
  findColumnPreset,
  findDefaultColumnPreset,
  updateColumnPreset,
} from "../domains/screener/columnPresets.repository.js";
import {
  SYSTEM_DEFAULT_COLUMNS,
  addColumnPreset,
  editColumnPreset,
  resolveScreenerColumns,
} from "../domains/screener/columnPresets.service.js";

type Lookup = Awaited<ReturnType<typeof findFilterField>>;

const PER_FIELD: Lookup = {
  categoryKey: "valuation",
  metricKey: "marketRatios",
  metricName: "Market Ratios",
  fieldKey: "peRatio",
  fieldName: "PER",
  period: "daily",
};

const SAMPLE_ROW = {
  id: 1,
  name: "常用欄位",
  isDefault: false,
  columns: ["marketRatios.peRatio", "stock.price"],
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:00:00.000Z",
};

beforeEach(() => {
  vi.mocked(findFilterField).mockReset();
  vi.mocked(findFilterField).mockImplementation(async (metricKey, fieldKey) => {
    if (metricKey === "marketRatios" && fieldKey === "peRatio") return PER_FIELD;
    return null;
  });
  vi.mocked(createColumnPreset).mockReset();
  vi.mocked(updateColumnPreset).mockReset();
  vi.mocked(findColumnPreset).mockReset();
  vi.mocked(findDefaultColumnPreset).mockReset();
});

describe("addColumnPreset", () => {
  it("accepts the special stock.price field alongside catalog fields", async () => {
    vi.mocked(createColumnPreset).mockResolvedValue(SAMPLE_ROW);

    await addColumnPreset("uid1", "常用欄位", ["marketRatios.peRatio", "stock.price"], false);

    expect(createColumnPreset).toHaveBeenCalledWith(
      "uid1",
      "常用欄位",
      ["marketRatios.peRatio", "stock.price"],
      false,
    );
  });

  it("rejects a field that is neither a catalog field nor a special field", async () => {
    await expect(addColumnPreset("uid1", "x", ["nope.nope"], false)).rejects.toMatchObject({ statusCode: 400 });
    expect(createColumnPreset).not.toHaveBeenCalled();
  });

  it("turns a duplicate name (Prisma P2002) into a 409", async () => {
    vi.mocked(createColumnPreset).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    await expect(addColumnPreset("uid1", "常用欄位", [], false)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("editColumnPreset", () => {
  it("throws 404 when the repository finds no matching row", async () => {
    vi.mocked(updateColumnPreset).mockResolvedValue(null);
    await expect(editColumnPreset("uid1", 999, { name: "x" })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("resolveScreenerColumns", () => {
  it("uses an explicit columnPresetId when given", async () => {
    vi.mocked(findColumnPreset).mockResolvedValue(SAMPLE_ROW);

    const result = await resolveScreenerColumns("uid1", 1);

    expect(findColumnPreset).toHaveBeenCalledWith("uid1", 1);
    expect(result).toEqual({
      columnPresetId: 1,
      columns: [{ field: "marketRatios.peRatio" }, { field: "stock.price" }],
    });
  });

  it("throws 404 when the explicit columnPresetId doesn't exist for this user", async () => {
    vi.mocked(findColumnPreset).mockResolvedValue(null);
    await expect(resolveScreenerColumns("uid1", 999)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("falls back to the user's default column preset when no id is given", async () => {
    vi.mocked(findDefaultColumnPreset).mockResolvedValue(SAMPLE_ROW);

    const result = await resolveScreenerColumns("uid1");

    expect(result.columnPresetId).toBe(1);
  });

  it("falls back to the hardcoded system default when there's no id and no user default", async () => {
    vi.mocked(findDefaultColumnPreset).mockResolvedValue(null);

    const result = await resolveScreenerColumns("uid1");

    expect(result).toEqual({ columnPresetId: null, columns: SYSTEM_DEFAULT_COLUMNS });
  });
});
