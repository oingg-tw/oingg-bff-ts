import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/domains/filterCatalog/index.js", () => ({
  findFilterFields: vi.fn(),
}));

vi.mock("@/domains/screener/screenerPresets.repository.js", () => ({
  createPreset: vi.fn(),
  deletePreset: vi.fn(),
  findPreset: vi.fn(),
  listPresets: vi.fn(),
  setLastColumnPreset: vi.fn(),
  updatePreset: vi.fn(),
}));

vi.mock("@/domains/screener/screener.service.js", () => ({
  runScreener: vi.fn(),
}));

vi.mock("@/domains/screener/columnPresets.service.js", () => ({
  resolveScreenerColumns: vi.fn(),
}));

import { Prisma } from "@/generated/prisma/client.js";
import { findFilterFields } from "@/domains/filterCatalog/index.js";
import { resolveScreenerColumns } from "@/domains/screener/columnPresets.service.js";
import { runScreener } from "@/domains/screener/screener.service.js";
import {
  createPreset,
  deletePreset,
  findPreset,
  listPresets,
  setLastColumnPreset,
  updatePreset,
} from "@/domains/screener/screenerPresets.repository.js";
import {
  addPreset,
  editPreset,
  getPresetOrThrow,
  removePreset,
  runPreset,
} from "@/domains/screener/screenerPresets.service.js";

type Lookup = Awaited<ReturnType<typeof findFilterFields>>[number];

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
  metricKey: "grossMargin",
  metricName: "Gross Margin",
  fieldKey: "grossMarginTtm",
  fieldName: "Gross Margin (TTM)",
  period: "ttm",
};

const SAMPLE_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const COLUMN_PRESET_ID = "bbbbbbbb-0000-4000-8000-000000000007";
const OTHER_COLUMN_PRESET_ID = "bbbbbbbb-0000-4000-8000-000000000009";

const SAMPLE_ROW = {
  id: SAMPLE_ID,
  name: "績優股",
  lastColumnPresetId: null,
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:00:00.000Z",
  filters: [
    { metricKey: "roe", fieldKey: "roeTtmPct", min: 30, max: null, exclude: false },
    { metricKey: "grossMargin", fieldKey: "grossMarginTtm", min: 60, max: null, exclude: false },
  ],
};

beforeEach(() => {
  vi.mocked(findFilterFields).mockReset();
  vi.mocked(findFilterFields).mockImplementation(async (refs) =>
    refs
      .map((ref) => {
        if (ref.metricKey === "roe" && ref.fieldKey === "roeTtmPct") return ROE_FIELD;
        if (ref.metricKey === "grossMargin" && ref.fieldKey === "grossMarginTtm") return MARGIN_FIELD;
        return null;
      })
      .filter((f): f is Lookup => f !== null),
  );
  vi.mocked(createPreset).mockReset();
  vi.mocked(updatePreset).mockReset();
  vi.mocked(findPreset).mockReset();
  vi.mocked(listPresets).mockReset();
  vi.mocked(listPresets).mockResolvedValue([]);
  vi.mocked(deletePreset).mockReset();
  vi.mocked(setLastColumnPreset).mockReset();
  vi.mocked(runScreener).mockReset();
  vi.mocked(resolveScreenerColumns).mockReset();
});

describe("addPreset", () => {
  it("defaults an empty filter list to ROE > 30", async () => {
    vi.mocked(createPreset).mockResolvedValue(SAMPLE_ROW);

    await addPreset("uid1", []);

    expect(createPreset).toHaveBeenCalledWith("uid1", "未命名", [
      { metricKey: "roe", fieldKey: "roeTtmPct", min: 30, max: null, exclude: false },
    ]);
  });

  it("rejects a filter whose field doesn't exist in the catalog", async () => {
    await expect(
      addPreset("uid1", [{ field: "nope.nope", min: 1, max: null, exclude: false }]),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(createPreset).not.toHaveBeenCalled();
  });

  it("resolves each field to metricKey/fieldKey before saving", async () => {
    vi.mocked(createPreset).mockResolvedValue(SAMPLE_ROW);

    await addPreset("uid1", [
      { field: "roe.roeTtmPct", min: 30, max: null, exclude: false },
      { field: "grossMargin.grossMarginTtm", min: 60, max: null, exclude: false },
    ]);

    expect(createPreset).toHaveBeenCalledWith("uid1", "未命名", [
      { metricKey: "roe", fieldKey: "roeTtmPct", min: 30, max: null, exclude: false },
      { metricKey: "grossMargin", fieldKey: "grossMarginTtm", min: 60, max: null, exclude: false },
    ]);
  });

  // Regression test: fields used to be validated one at a time (one query per filter), which multiplied
  // network round trips to the remote app DB by the filter count. Must be a single batched lookup.
  it("validates all filter fields in a single batched lookup, not one query per filter", async () => {
    vi.mocked(createPreset).mockResolvedValue(SAMPLE_ROW);

    await addPreset("uid1", [
      { field: "roe.roeTtmPct", min: 30, max: null, exclude: false },
      { field: "grossMargin.grossMarginTtm", min: 60, max: null, exclude: false },
    ]);

    expect(findFilterFields).toHaveBeenCalledTimes(1);
    expect(findFilterFields).toHaveBeenCalledWith([
      { metricKey: "roe", fieldKey: "roeTtmPct" },
      { metricKey: "grossMargin", fieldKey: "grossMarginTtm" },
    ]);
  });

  it("falls back to '未命名 2' when '未命名' is already taken, instead of erroring", async () => {
    vi.mocked(listPresets).mockResolvedValue([{ ...SAMPLE_ROW, name: "未命名" }]);
    vi.mocked(createPreset).mockResolvedValue({ ...SAMPLE_ROW, name: "未命名 2" });

    const result = await addPreset("uid1", [{ field: "roe.roeTtmPct", min: 30, max: null, exclude: false }]);

    expect(createPreset).toHaveBeenCalledWith("uid1", "未命名 2", [
      { metricKey: "roe", fieldKey: "roeTtmPct", min: 30, max: null, exclude: false },
    ]);
    expect(result.name).toBe("未命名 2");
  });

  it("keeps incrementing past multiple taken suffixes ('未命名', '未命名 2', ... -> '未命名 3')", async () => {
    vi.mocked(listPresets).mockResolvedValue([
      { ...SAMPLE_ROW, name: "未命名" },
      { ...SAMPLE_ROW, name: "未命名 2" },
    ]);
    vi.mocked(createPreset).mockResolvedValue({ ...SAMPLE_ROW, name: "未命名 3" });

    await addPreset("uid1", [{ field: "roe.roeTtmPct", min: 30, max: null, exclude: false }]);

    expect(createPreset).toHaveBeenCalledWith("uid1", "未命名 3", expect.anything());
  });

  // Regression: a stale name-availability check (checked once, then inserted) could still race with a
  // concurrent request grabbing the same name in between. The P2002 from the DB's unique constraint
  // must trigger a retry, not surface as an error straight to the caller.
  it("retries with a fresh name pick if the insert itself hits a unique-constraint race (P2002)", async () => {
    vi.mocked(createPreset)
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "test",
        }),
      )
      .mockResolvedValueOnce(SAMPLE_ROW);

    const result = await addPreset("uid1", [{ field: "roe.roeTtmPct", min: 30, max: null, exclude: false }]);

    expect(createPreset).toHaveBeenCalledTimes(2);
    expect(result.name).toBe(SAMPLE_ROW.name);
  });

  // Regression test: a prior version of addPreset auto-created a per-user ColumnPreset row and
  // pointed lastColumnPresetId at it. That materializes the default at creation time — a later change
  // to the default-resolution logic would then never reach already-created users. addPreset must leave
  // column presets alone entirely; the default is only ever resolved live at run time (see
  // resolveScreenerColumns in columnPresets.service.ts).
  it("never touches column presets — lastColumnPresetId stays whatever the repository returns (usually null)", async () => {
    vi.mocked(createPreset).mockResolvedValue(SAMPLE_ROW);

    const result = await addPreset("uid1", []);

    expect(setLastColumnPreset).not.toHaveBeenCalled();
    expect(result.lastColumnPresetId).toBe(SAMPLE_ROW.lastColumnPresetId);
  });
});

describe("editPreset", () => {
  it("allows replacing filters with an empty array", async () => {
    vi.mocked(updatePreset).mockResolvedValue({ ...SAMPLE_ROW, filters: [] });

    await editPreset("uid1", SAMPLE_ID, { filters: [] });

    expect(updatePreset).toHaveBeenCalledWith("uid1", SAMPLE_ID, { name: undefined, filters: [] });
  });

  it("throws 404 when the repository finds no matching row", async () => {
    vi.mocked(updatePreset).mockResolvedValue(null);
    await expect(editPreset("uid1", "missing-uuid", { name: "x" })).rejects.toMatchObject({ statusCode: 404 });
  });

  it("turns a duplicate name conflict into 409", async () => {
    vi.mocked(updatePreset).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    await expect(editPreset("uid1", SAMPLE_ID, { name: "重複" })).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("getPresetOrThrow / removePreset", () => {
  it("getPresetOrThrow throws 404 when not found", async () => {
    vi.mocked(findPreset).mockResolvedValue(null);
    await expect(getPresetOrThrow("uid1", "missing-uuid")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("removePreset throws 404 when nothing was deleted", async () => {
    vi.mocked(deletePreset).mockResolvedValue(false);
    await expect(removePreset("uid1", "missing-uuid")).rejects.toMatchObject({ statusCode: 404 });
  });
});

const SAMPLE_SCREENER_RESULT = {
  count: 1,
  page: 1,
  pageSize: 50,
  totalPages: 1,
  columns: [{ field: "per.peRatio", metricName: "本益比 PER", fieldName: "本益比 PER" }],
  results: [{ symbol: "2330", name: "台積電", values: { "per.peRatio": { value: "27.82", asOfDate: "2026-08-28" } } }],
};

const DEFAULT_PAGINATION = { page: 1, pageSize: 50 };

describe("runPreset", () => {
  it("throws 404 when the preset doesn't exist for this user", async () => {
    vi.mocked(findPreset).mockResolvedValue(null);
    await expect(runPreset("uid1", "missing-uuid", DEFAULT_PAGINATION)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(runScreener).not.toHaveBeenCalled();
  });

  it("with no columnPresetId and no last-used one, resolves columns with undefined (falls to user default/system default)", async () => {
    vi.mocked(findPreset).mockResolvedValue(SAMPLE_ROW);
    vi.mocked(resolveScreenerColumns).mockResolvedValue({
      columnPresetId: null,
      columns: [{ field: "per.peRatio" }],
    });
    vi.mocked(runScreener).mockResolvedValue(SAMPLE_SCREENER_RESULT);

    const result = await runPreset("uid1", SAMPLE_ID, DEFAULT_PAGINATION);

    expect(resolveScreenerColumns).toHaveBeenCalledWith("uid1", undefined);
    expect(setLastColumnPreset).not.toHaveBeenCalled();
    expect(runScreener).toHaveBeenCalledWith(
      [
        { field: "roe.roeTtmPct", min: 30, max: null, exclude: false },
        { field: "grossMargin.grossMarginTtm", min: 60, max: null, exclude: false },
      ],
      [{ field: "per.peRatio" }],
      DEFAULT_PAGINATION,
    );
    expect(result.preset.name).toBe("績優股");
    expect(result.columnPresetId).toBeNull();
  });

  it("with no explicit columnPresetId, falls back to the preset's last-used column preset", async () => {
    vi.mocked(findPreset).mockResolvedValue({ ...SAMPLE_ROW, lastColumnPresetId: COLUMN_PRESET_ID });
    vi.mocked(resolveScreenerColumns).mockResolvedValue({ columnPresetId: COLUMN_PRESET_ID, columns: [] });
    vi.mocked(runScreener).mockResolvedValue(SAMPLE_SCREENER_RESULT);

    await runPreset("uid1", SAMPLE_ID, DEFAULT_PAGINATION);

    expect(resolveScreenerColumns).toHaveBeenCalledWith("uid1", COLUMN_PRESET_ID);
    expect(setLastColumnPreset).not.toHaveBeenCalled();
  });

  it("with an explicit columnPresetId, uses it and remembers it as the preset's new last-used column preset", async () => {
    vi.mocked(findPreset).mockResolvedValue({ ...SAMPLE_ROW, lastColumnPresetId: COLUMN_PRESET_ID });
    vi.mocked(resolveScreenerColumns).mockResolvedValue({ columnPresetId: OTHER_COLUMN_PRESET_ID, columns: [] });
    vi.mocked(runScreener).mockResolvedValue(SAMPLE_SCREENER_RESULT);

    const result = await runPreset("uid1", SAMPLE_ID, DEFAULT_PAGINATION, OTHER_COLUMN_PRESET_ID);

    expect(resolveScreenerColumns).toHaveBeenCalledWith("uid1", OTHER_COLUMN_PRESET_ID);
    expect(setLastColumnPreset).toHaveBeenCalledWith("uid1", SAMPLE_ID, OTHER_COLUMN_PRESET_ID);
    expect(result.columnPresetId).toBe(OTHER_COLUMN_PRESET_ID);
  });

  it("forwards page/pageSize through to runScreener", async () => {
    vi.mocked(findPreset).mockResolvedValue(SAMPLE_ROW);
    vi.mocked(resolveScreenerColumns).mockResolvedValue({ columnPresetId: null, columns: [] });
    vi.mocked(runScreener).mockResolvedValue(SAMPLE_SCREENER_RESULT);

    await runPreset("uid1", SAMPLE_ID, { page: 2, pageSize: 10 });

    expect(runScreener).toHaveBeenCalledWith(expect.anything(), expect.anything(), { page: 2, pageSize: 10 });
  });
});
