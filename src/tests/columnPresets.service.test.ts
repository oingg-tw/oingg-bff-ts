import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../domains/filterCatalog/index.js", () => ({
  findFilterFields: vi.fn(),
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
import { findFilterFields } from "../domains/filterCatalog/index.js";
import {
  createColumnPreset,
  findColumnPreset,
  findDefaultColumnPreset,
  listColumnPresets,
  updateColumnPreset,
} from "../domains/screener/columnPresets.repository.js";
import {
  addColumnPreset,
  addColumnPresetWithName,
  editColumnPreset,
  resolveScreenerColumns,
} from "../domains/screener/columnPresets.service.js";

type Lookup = Awaited<ReturnType<typeof findFilterFields>>[number];

const PER_FIELD: Lookup = {
  categoryKey: "valuation",
  metricKey: "per",
  metricName: "本益比 PER",
  fieldKey: "peRatio",
  fieldName: "本益比 PER",
  period: "daily",
};

const PBR_FIELD: Lookup = {
  categoryKey: "valuation",
  metricKey: "pbr",
  metricName: "股價淨值比 PBR",
  fieldKey: "pbRatio",
  fieldName: "股價淨值比 PBR",
  period: "daily",
};

const SAMPLE_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER_ID = "aaaaaaaa-0000-4000-8000-000000000006";

const SAMPLE_ROW = {
  id: SAMPLE_ID,
  name: "常用欄位",
  isDefault: false,
  columns: ["per.peRatio", "stock.price"],
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:00:00.000Z",
};

beforeEach(() => {
  vi.mocked(findFilterFields).mockReset();
  vi.mocked(findFilterFields).mockImplementation(async (refs) =>
    refs
      .map((ref) => {
        if (ref.metricKey === "per" && ref.fieldKey === "peRatio") return PER_FIELD;
        if (ref.metricKey === "pbr" && ref.fieldKey === "pbRatio") return PBR_FIELD;
        return null;
      })
      .filter((f): f is Lookup => f !== null),
  );
  vi.mocked(createColumnPreset).mockReset();
  vi.mocked(updateColumnPreset).mockReset();
  vi.mocked(findColumnPreset).mockReset();
  vi.mocked(findDefaultColumnPreset).mockReset();
  vi.mocked(listColumnPresets).mockReset();
});

describe("addColumnPreset", () => {
  it("accepts the special stock.price field alongside catalog fields", async () => {
    vi.mocked(createColumnPreset).mockResolvedValue(SAMPLE_ROW);

    await addColumnPreset("uid1", "常用欄位", ["per.peRatio", "stock.price"], false);

    expect(createColumnPreset).toHaveBeenCalledWith("uid1", "常用欄位", ["per.peRatio", "stock.price"], false);
  });

  it("rejects a field that is neither a catalog field nor a special field", async () => {
    await expect(addColumnPreset("uid1", "x", ["nope.nope"], false)).rejects.toMatchObject({ statusCode: 400 });
    expect(createColumnPreset).not.toHaveBeenCalled();
  });

  // Regression test: fields used to be validated one at a time (one query per field, sequentially
  // awaited even). Must be a single batched lookup regardless of how many fields are given — every
  // call findFilterFields receives here should carry all the catalog fields at once, never one at a time.
  it("validates all fields in a single batched lookup, not one query per field", async () => {
    vi.mocked(createColumnPreset).mockResolvedValue({
      ...SAMPLE_ROW,
      columns: ["per.peRatio", "pbr.pbRatio", "stock.price"],
    });

    await addColumnPreset("uid1", "常用欄位", ["per.peRatio", "pbr.pbRatio", "stock.price"], false);

    // validateFields (input) + toView (the created row's own columns) — 2 calls total, each batched
    // to cover both catalog fields at once rather than one call per field.
    expect(findFilterFields).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(findFilterFields).mock.calls) {
      expect(call[0]).toEqual([
        { field: "per.peRatio", metricKey: "per", fieldKey: "peRatio" },
        { field: "pbr.pbRatio", metricKey: "pbr", fieldKey: "pbRatio" },
      ]);
    }
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

describe("addColumnPresetWithName", () => {
  it("uses the given name as-is when it doesn't collide with an existing preset", async () => {
    vi.mocked(listColumnPresets).mockResolvedValue([]);
    vi.mocked(createColumnPreset).mockResolvedValue({ ...SAMPLE_ROW, name: "獲利品質拆解" });

    await addColumnPresetWithName("uid1", "獲利品質拆解", ["per.peRatio"]);

    expect(createColumnPreset).toHaveBeenCalledWith("uid1", "獲利品質拆解", ["per.peRatio"], false);
  });

  // Regression-shaped: same "name", "name 2", "name 3", ... behavior as addPresetWithName
  // (screenerPresets.service.ts) — applying the same template twice must not 409, it should create a
  // second, separately-named preset.
  it("falls through to 'name 2' when the base name is already taken", async () => {
    vi.mocked(listColumnPresets).mockResolvedValue([{ ...SAMPLE_ROW, name: "獲利品質拆解" }]);
    vi.mocked(createColumnPreset).mockResolvedValue({ ...SAMPLE_ROW, name: "獲利品質拆解 2" });

    await addColumnPresetWithName("uid1", "獲利品質拆解", ["per.peRatio"]);

    expect(createColumnPreset).toHaveBeenCalledWith("uid1", "獲利品質拆解 2", ["per.peRatio"], false);
  });

  it("rejects a field that is neither a catalog field nor a special field", async () => {
    vi.mocked(listColumnPresets).mockResolvedValue([]);
    await expect(addColumnPresetWithName("uid1", "x", ["nope.nope"])).rejects.toMatchObject({ statusCode: 400 });
    expect(createColumnPreset).not.toHaveBeenCalled();
  });
});

describe("editColumnPreset", () => {
  it("throws 404 when the repository finds no matching row", async () => {
    vi.mocked(updateColumnPreset).mockResolvedValue(null);
    await expect(editColumnPreset("uid1", "missing-uuid", { name: "x" })).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe("resolveScreenerColumns", () => {
  it("uses an explicit columnPresetId when given", async () => {
    vi.mocked(findColumnPreset).mockResolvedValue(SAMPLE_ROW);

    const result = await resolveScreenerColumns("uid1", SAMPLE_ID);

    expect(findColumnPreset).toHaveBeenCalledWith("uid1", SAMPLE_ID);
    expect(result).toEqual({
      columnPresetId: SAMPLE_ID,
      columns: [{ field: "per.peRatio" }, { field: "stock.price" }],
    });
  });

  it("throws 404 when the explicit columnPresetId doesn't exist for this user", async () => {
    vi.mocked(findColumnPreset).mockResolvedValue(null);
    await expect(resolveScreenerColumns("uid1", "missing-uuid")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("falls back to the user's default column preset when no id is given", async () => {
    vi.mocked(findDefaultColumnPreset).mockResolvedValue(SAMPLE_ROW);

    const result = await resolveScreenerColumns("uid1");

    expect(result.columnPresetId).toBe(SAMPLE_ID);
  });

  // Regression test: there used to be a hardcoded SYSTEM_DEFAULT_COLUMNS fallback here. Removed — the
  // intended replacement is a curated/official default column set analogous to PresetTemplate, not
  // another hardcoded array in this service. Until that exists, no columns beats a stale hardcoded guess.
  it("falls back to no columns at all when there's no id and no user default", async () => {
    vi.mocked(findDefaultColumnPreset).mockResolvedValue(null);

    const result = await resolveScreenerColumns("uid1");

    expect(result).toEqual({ columnPresetId: null, columns: [] });
  });

  // Regression test: matching stocks must never come back as bare symbols with no field data hidden
  // behind a resolved-but-empty preset silently looking the same as "no preset" — but since there's no
  // system default columns to fall through to anymore, this now surfaces the same as any other
  // preset-not-found case: columnPresetId: null, no columns. An explicit columnPresetId that resolves to
  // a real but empty ("columns": []) preset — e.g. a tab the user created and never filled in — must not
  // be honored as columnPresetId pointing at it, since there's nothing there to attribute results to.
  it("treats an explicit columnPresetId that resolves to a preset with zero columns the same as no preset found", async () => {
    vi.mocked(findColumnPreset).mockResolvedValue({ ...SAMPLE_ROW, id: OTHER_ID, name: "欄位組合 1", columns: [] });

    const result = await resolveScreenerColumns("uid1", OTHER_ID);

    expect(result).toEqual({ columnPresetId: null, columns: [] });
  });

  it("treats the user's own default preset having zero columns the same as no default set", async () => {
    vi.mocked(findDefaultColumnPreset).mockResolvedValue({ ...SAMPLE_ROW, columns: [] });

    const result = await resolveScreenerColumns("uid1");

    expect(result).toEqual({ columnPresetId: null, columns: [] });
  });
});
