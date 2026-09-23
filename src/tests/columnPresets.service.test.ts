import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeColumnPresets } from "@/tests/fakes/columnPresets.js";
import { fakeMetricCatalog } from "@/tests/fakes/metricCatalog.js";
import { fakeColumnPresetTemplates } from "@/tests/fakes/presetTemplates.js";
import {
  addColumnPreset,
  addColumnPresetWithName,
  editColumnPreset,
  getColumnPresets,
  reorderColumnPresetsForUser,
  resolveScreenerColumns,
} from "@/application/screener/columnPresets.service.js";
import type { MetricFieldLookup, MetricFieldRef } from "@/application/metricCatalog/metricCatalog.types.js";

type Lookup = MetricFieldLookup;

/**
 * A typed fake of MetricCatalogPort instead of `vi.mock` on the repository module — the batching
 * assertions below are about how many times this slice asks the *port* to resolve fields, which is the
 * contract, not about which module happens to answer.
 */
const findFields = vi.fn();
const metricCatalog = fakeMetricCatalog({ findFields });

const PER_FIELD: Lookup = {
  categoryKey: "valuation",
  metricKey: "per",
  metricName: "本益比 PER",
  fieldKey: "peRatio",
  fieldName: "本益比 PER",
  period: "daily",
  unit: "times",
};

const PBR_FIELD: Lookup = {
  categoryKey: "valuation",
  metricKey: "pbr",
  metricName: "股價淨值比 PBR",
  fieldKey: "pbRatio",
  fieldName: "股價淨值比 PBR",
  period: "daily",
  unit: "times",
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

/** The three ports this slice's use cases take, with "nothing saved, nothing curated" defaults. */
function deps(
  columnPresets = fakeColumnPresets(),
  columnPresetTemplates = fakeColumnPresetTemplates(),
): {
  columnPresets: ReturnType<typeof fakeColumnPresets>;
  columnPresetTemplates: ReturnType<typeof fakeColumnPresetTemplates>;
  metricCatalog: typeof metricCatalog;
} {
  return { columnPresets, columnPresetTemplates, metricCatalog };
}

beforeEach(() => {
  findFields.mockReset();
  findFields.mockImplementation(async (refs: MetricFieldRef[]) =>
    refs
      .map((ref) => {
        if (ref.metricKey === "per" && ref.fieldKey === "peRatio") return PER_FIELD;
        if (ref.metricKey === "pbr" && ref.fieldKey === "pbRatio") return PBR_FIELD;
        return null;
      })
      .filter((f): f is Lookup => f !== null),
  );
});

describe("getColumnPresets", () => {
  // Perf regression test (2026-09-01): used to call toView() per preset row via Promise.all, each doing
  // its own resolveColumnFields round trip — N presets meant N separate remote DB queries (concurrent,
  // but still N of them) instead of one. Must batch every preset's columns into a single lookup.
  it("resolves every preset's columns in a single batched findFields call, not one per preset", async () => {
    const columnPresets = fakeColumnPresets({
      list: vi.fn().mockResolvedValue([
        { ...SAMPLE_ROW, id: SAMPLE_ID, columns: ["per.peRatio"] },
        { ...SAMPLE_ROW, id: OTHER_ID, columns: ["pbr.pbRatio"] },
      ]),
    });

    const result = await getColumnPresets("uid1", deps(columnPresets));

    expect(findFields).toHaveBeenCalledTimes(1);
    expect(findFields).toHaveBeenCalledWith([
      { field: "per.peRatio", metricKey: "per", fieldKey: "peRatio" },
      { field: "pbr.pbRatio", metricKey: "pbr", fieldKey: "pbRatio" },
    ]);
    expect(result).toEqual([
      {
        id: SAMPLE_ID,
        name: "常用欄位",
        isDefault: false,
        columns: [{ field: "per.peRatio", metricName: "本益比 PER", fieldName: "本益比 PER" }],
        createdAt: "2026-08-27T00:00:00.000Z",
        updatedAt: "2026-08-27T00:00:00.000Z",
      },
      {
        id: OTHER_ID,
        name: "常用欄位",
        isDefault: false,
        columns: [{ field: "pbr.pbRatio", metricName: "股價淨值比 PBR", fieldName: "股價淨值比 PBR" }],
        createdAt: "2026-08-27T00:00:00.000Z",
        updatedAt: "2026-08-27T00:00:00.000Z",
      },
    ]);
  });

  it("doesn't request the same field twice when multiple presets share a column", async () => {
    const columnPresets = fakeColumnPresets({
      list: vi.fn().mockResolvedValue([
        { ...SAMPLE_ROW, id: SAMPLE_ID, columns: ["per.peRatio"] },
        { ...SAMPLE_ROW, id: OTHER_ID, columns: ["per.peRatio"] },
      ]),
    });

    await getColumnPresets("uid1", deps(columnPresets));

    expect(findFields).toHaveBeenCalledWith([{ field: "per.peRatio", metricKey: "per", fieldKey: "peRatio" }]);
  });

  it("returns an empty array without calling findFields when the user has no presets", async () => {
    const result = await getColumnPresets("uid1", deps());

    expect(result).toEqual([]);
    expect(findFields).not.toHaveBeenCalled();
  });
});

describe("addColumnPreset", () => {
  it("accepts the special stock.price field alongside catalog fields", async () => {
    const columnPresets = fakeColumnPresets({ create: vi.fn().mockResolvedValue({ ok: true, row: SAMPLE_ROW }) });

    await addColumnPreset("uid1", "常用欄位", ["per.peRatio", "stock.price"], false, deps(columnPresets));

    expect(columnPresets.create).toHaveBeenCalledWith("uid1", "常用欄位", ["per.peRatio", "stock.price"], false);
  });

  it("rejects a field that is neither a catalog field nor a special field", async () => {
    const columnPresets = fakeColumnPresets();

    await expect(addColumnPreset("uid1", "x", ["nope.nope"], false, deps(columnPresets))).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(columnPresets.create).not.toHaveBeenCalled();
  });

  // Regression test: fields used to be validated one at a time (one query per field, sequentially
  // awaited even). Must be a single batched lookup regardless of how many fields are given — every
  // call findFields receives here should carry all the catalog fields at once, never one at a time.
  it("validates all fields in a single batched lookup, not one query per field", async () => {
    const columnPresets = fakeColumnPresets({
      create: vi.fn().mockResolvedValue({
        ok: true,
        row: { ...SAMPLE_ROW, columns: ["per.peRatio", "pbr.pbRatio", "stock.price"] },
      }),
    });

    await addColumnPreset(
      "uid1",
      "常用欄位",
      ["per.peRatio", "pbr.pbRatio", "stock.price"],
      false,
      deps(columnPresets),
    );

    // validateFields (input) + toView (the created row's own columns) — 2 calls total, each batched
    // to cover both catalog fields at once rather than one call per field.
    expect(findFields).toHaveBeenCalledTimes(2);
    for (const call of findFields.mock.calls) {
      expect(call[0]).toEqual([
        { field: "per.peRatio", metricKey: "per", fieldKey: "peRatio" },
        { field: "pbr.pbRatio", metricKey: "pbr", fieldKey: "pbRatio" },
      ]);
    }
  });

  // The duplicate case arrives as a value, not as a Prisma error. Before the ports refactor this
  // assertion had to construct a PrismaClientKnownRequestError with code "P2002" — a test that proved
  // the service understood one driver's error taxonomy rather than proving the 409 rule.
  it("turns a duplicate name into a 409 without knowing anything about the database", async () => {
    const columnPresets = fakeColumnPresets({ create: vi.fn().mockResolvedValue({ ok: false, reason: "duplicate" }) });

    await expect(addColumnPreset("uid1", "常用欄位", [], false, deps(columnPresets))).rejects.toMatchObject({
      statusCode: 409,
    });
  });
});

describe("addColumnPresetWithName", () => {
  it("uses the given name as-is when it doesn't collide with an existing preset", async () => {
    const columnPresets = fakeColumnPresets({
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ ok: true, row: { ...SAMPLE_ROW, name: "獲利品質拆解" } }),
    });

    await addColumnPresetWithName("uid1", "獲利品質拆解", ["per.peRatio"], deps(columnPresets));

    expect(columnPresets.create).toHaveBeenCalledWith("uid1", "獲利品質拆解", ["per.peRatio"], false);
  });

  // Regression-shaped: same "name", "name 2", "name 3", ... behavior as addPresetWithName
  // (screenerPresets.service.ts) — applying the same template twice must not 409, it should create a
  // second, separately-named preset. Note this is the same port result ({ ok: false, reason:
  // "duplicate" }) that addColumnPreset above turns into a 409: the difference is the use case's rule,
  // not the storage's.
  it("falls through to 'name 2' when the base name is already taken", async () => {
    const columnPresets = fakeColumnPresets({
      list: vi.fn().mockResolvedValue([{ ...SAMPLE_ROW, name: "獲利品質拆解" }]),
      create: vi.fn().mockResolvedValue({ ok: true, row: { ...SAMPLE_ROW, name: "獲利品質拆解 2" } }),
    });

    await addColumnPresetWithName("uid1", "獲利品質拆解", ["per.peRatio"], deps(columnPresets));

    expect(columnPresets.create).toHaveBeenCalledWith("uid1", "獲利品質拆解 2", ["per.peRatio"], false);
  });

  it("rejects a field that is neither a catalog field nor a special field", async () => {
    const columnPresets = fakeColumnPresets({ list: vi.fn().mockResolvedValue([]) });

    await expect(
      addColumnPresetWithName("uid1", "x", ["nope.nope"], deps(columnPresets)),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(columnPresets.create).not.toHaveBeenCalled();
  });
});

describe("editColumnPreset", () => {
  it("throws 404 when the port reports no matching row", async () => {
    const columnPresets = fakeColumnPresets({ update: vi.fn().mockResolvedValue({ ok: false, reason: "not-found" }) });

    await expect(
      editColumnPreset("uid1", "missing-uuid", { name: "x" }, deps(columnPresets)),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("turns a duplicate name into a 409", async () => {
    const columnPresets = fakeColumnPresets({ update: vi.fn().mockResolvedValue({ ok: false, reason: "duplicate" }) });

    await expect(
      editColumnPreset("uid1", SAMPLE_ID, { name: "重複" }, deps(columnPresets)),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("resolveScreenerColumns", () => {
  it("uses an explicit columnPresetId when given", async () => {
    const columnPresets = fakeColumnPresets({ find: vi.fn().mockResolvedValue(SAMPLE_ROW) });

    const result = await resolveScreenerColumns("uid1", SAMPLE_ID, deps(columnPresets));

    expect(columnPresets.find).toHaveBeenCalledWith("uid1", SAMPLE_ID);
    expect(result).toEqual({
      columnPresetId: SAMPLE_ID,
      columns: [{ field: "per.peRatio" }, { field: "stock.price" }],
    });
  });

  it("throws 404 when the explicit columnPresetId doesn't exist for this user", async () => {
    await expect(resolveScreenerColumns("uid1", "missing-uuid", deps())).rejects.toMatchObject({ statusCode: 404 });
  });

  it("falls back to the user's default column preset when no id is given", async () => {
    const columnPresets = fakeColumnPresets({ findDefault: vi.fn().mockResolvedValue(SAMPLE_ROW) });

    const result = await resolveScreenerColumns("uid1", undefined, deps(columnPresets));

    expect(result.columnPresetId).toBe(SAMPLE_ID);
  });

  const OVERVIEW_TEMPLATE = {
    key: "overview",
    name: "總覽",
    description: "本益比、股價淨值比、殖利率、ROE、負債比...",
    fieldKeys: ["per.peRatio", "pbr.pbRatio", "roe.roeTtmPct"],
    isDefault: true,
  };

  // Current behavior: falls back to the curated "overview" ColumnPresetTemplate — the replacement for
  // the old hardcoded SYSTEM_DEFAULT_COLUMNS array, curated in the DB instead. This is now the
  // screener's real default until the caller picks/customizes something, for both signed-in users with
  // no saved default and anonymous callers (see below).
  it("falls back to the curated overview columnPresetTemplate when there's no id and no user default", async () => {
    const columnPresetTemplates = fakeColumnPresetTemplates({
      findDefault: vi.fn().mockResolvedValue(OVERVIEW_TEMPLATE),
    });

    const result = await resolveScreenerColumns("uid1", undefined, deps(fakeColumnPresets(), columnPresetTemplates));

    expect(result).toEqual({
      columnPresetId: null,
      columns: [{ field: "per.peRatio" }, { field: "pbr.pbRatio" }],
    });
  });

  it("falls back to no columns at all when there's no id, no user default, and no curated template yet", async () => {
    const result = await resolveScreenerColumns("uid1", undefined, deps());

    expect(result).toEqual({ columnPresetId: null, columns: [] });
  });

  // Also covers the drop-invalid-fields regression (2026-09-08): OVERVIEW_TEMPLATE includes
  // roe.roeTtmPct, which the findFields fake above doesn't recognize — analysis-ts's own
  // "overview" columnPreset kept referencing a field already dropped from their /filters `categories`
  // catalog, which made every screener call without an explicit columnPresetId fail 100% of the time
  // with an "unknown filter field" error unrelated to what the caller actually asked for. Must drop
  // unresolvable fields instead of passing them through and letting resolveCatalogFieldRefs blow up the
  // entire request downstream.
  it("uses the curated overview template for anonymous callers, dropping fields that don't resolve against the current catalog", async () => {
    const columnPresets = fakeColumnPresets();
    const columnPresetTemplates = fakeColumnPresetTemplates({
      findDefault: vi.fn().mockResolvedValue(OVERVIEW_TEMPLATE),
    });

    const result = await resolveScreenerColumns(undefined, undefined, deps(columnPresets, columnPresetTemplates));

    expect(columnPresets.find).not.toHaveBeenCalled();
    expect(result).toEqual({
      columnPresetId: null,
      columns: [{ field: "per.peRatio" }, { field: "pbr.pbRatio" }],
    });
  });

  it("gives an anonymous caller no columns when there's no curated template yet either", async () => {
    const result = await resolveScreenerColumns(undefined, undefined, deps());

    expect(result).toEqual({ columnPresetId: null, columns: [] });
  });

  // Regression test: matching stocks must never come back as bare symbols with no field data hidden
  // behind a resolved-but-empty preset silently looking the same as "no preset". An explicit
  // columnPresetId that resolves to a real but empty ("columns": []) preset — e.g. a tab the user
  // created and never filled in — must not be honored as columnPresetId pointing at it, since there's
  // nothing there to attribute results to; it falls through to the same curated-template fallback as
  // "no preset found".
  it("treats an explicit columnPresetId that resolves to a preset with zero columns the same as no preset found", async () => {
    const columnPresets = fakeColumnPresets({
      find: vi.fn().mockResolvedValue({ ...SAMPLE_ROW, id: OTHER_ID, name: "欄位組合 1", columns: [] }),
    });

    const result = await resolveScreenerColumns("uid1", OTHER_ID, deps(columnPresets));

    expect(result).toEqual({ columnPresetId: null, columns: [] });
  });

  it("treats the user's own default preset having zero columns the same as no default set", async () => {
    const columnPresets = fakeColumnPresets({
      findDefault: vi.fn().mockResolvedValue({ ...SAMPLE_ROW, columns: [] }),
    });

    const result = await resolveScreenerColumns("uid1", undefined, deps(columnPresets));

    expect(result).toEqual({ columnPresetId: null, columns: [] });
  });
});

describe("reorderColumnPresetsForUser", () => {
  it("passes the ordered ids straight through to the port and returns the reordered view", async () => {
    const columnPresets = fakeColumnPresets({
      reorder: vi.fn().mockResolvedValue([
        { ...SAMPLE_ROW, id: OTHER_ID, columns: ["pbr.pbRatio"] },
        { ...SAMPLE_ROW, id: SAMPLE_ID, columns: ["per.peRatio"] },
      ]),
    });

    const result = await reorderColumnPresetsForUser("uid1", [OTHER_ID, SAMPLE_ID], deps(columnPresets));

    expect(columnPresets.reorder).toHaveBeenCalledWith("uid1", [OTHER_ID, SAMPLE_ID]);
    expect(result.map((r) => r.id)).toEqual([OTHER_ID, SAMPLE_ID]);
  });

  // The port returns null when `ids` isn't exactly the user's current full set — must surface as
  // a 400, not a 500 or a silent no-op.
  it("throws a 400 when the port reports ids don't match the user's current full set", async () => {
    const columnPresets = fakeColumnPresets({ reorder: vi.fn().mockResolvedValue(null) });

    await expect(
      reorderColumnPresetsForUser("uid1", [SAMPLE_ID], deps(columnPresets)),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
