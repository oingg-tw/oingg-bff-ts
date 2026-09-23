import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/application/metricCatalog/index.js", () => ({
  findMetricFields: vi.fn(),
}));

import { findMetricFields } from "@/application/metricCatalog/index.js";
import { fakeScreenerPresets } from "@/tests/fakes/screenerPresets.js";
import {
  addPreset,
  editPreset,
  getPresetOrThrow,
  removePreset,
  reorderPresetsForUser,
} from "@/application/screener/screenerPresets.service.js";

type Lookup = Awaited<ReturnType<typeof findMetricFields>>[number];

const ROE_FIELD: Lookup = {
  categoryKey: "profitability",
  metricKey: "roe",
  metricName: "ROE",
  fieldKey: "roeTtmPct",
  fieldName: "ROE (TTM)",
  period: "ttm",
  unit: "percent",
};
// pitMetrics-era addressing (2026-09-08) for DEFAULT_PRESET_FILTERS — see screenerPresets.service.ts.
const ROE_TTM_FIELD: Lookup = {
  categoryKey: "profitability",
  metricKey: "roe",
  metricName: "roe",
  fieldKey: "TTM",
  fieldName: "TTM",
  period: "TTM",
  unit: null,
};
const MARGIN_FIELD: Lookup = {
  categoryKey: "profitability",
  metricKey: "grossMargin",
  metricName: "Gross Margin",
  fieldKey: "grossMarginTtm",
  fieldName: "Gross Margin (TTM)",
  period: "ttm",
  unit: "percent",
};

const SAMPLE_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER_ID = "aaaaaaaa-0000-4000-8000-000000000002";

const SAMPLE_ROW = {
  id: SAMPLE_ID,
  name: "績優股",
  sectorCodes: [] as string[],
  excludeSectorCodes: [] as string[],
  lastColumnPresetId: null,
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:00:00.000Z",
  filters: [
    { metricKey: "roe", fieldKey: "roeTtmPct", min: 30, max: null, exclude: false },
    { metricKey: "grossMargin", fieldKey: "grossMarginTtm", min: 60, max: null, exclude: false },
  ],
};

beforeEach(() => {
  vi.mocked(findMetricFields).mockReset();
  vi.mocked(findMetricFields).mockImplementation(async (refs) =>
    refs
      .map((ref) => {
        if (ref.metricKey === "roe" && ref.fieldKey === "roeTtmPct") return ROE_FIELD;
        if (ref.metricKey === "roe" && ref.fieldKey === "TTM") return ROE_TTM_FIELD;
        if (ref.metricKey === "grossMargin" && ref.fieldKey === "grossMarginTtm") return MARGIN_FIELD;
        return null;
      })
      .filter((f): f is Lookup => f !== null),
  );
});

describe("addPreset", () => {
  it("defaults an empty filter list to ROE > 30", async () => {
    const screenerPresets = fakeScreenerPresets({ create: vi.fn().mockResolvedValue({ ok: true, row: SAMPLE_ROW }) });

    await addPreset("uid1", [], undefined, undefined, { screenerPresets });

    expect(screenerPresets.create).toHaveBeenCalledWith(
      "uid1",
      "未命名",
      [{ metricKey: "roe", fieldKey: "TTM", min: 30, max: null, exclude: false }],
      [],
      [],
    );
  });

  it("rejects a filter whose field doesn't exist in the catalog", async () => {
    const screenerPresets = fakeScreenerPresets();

    await expect(
      addPreset("uid1", [{ field: "nope.nope", min: 1, max: null, exclude: false }], undefined, undefined, {
        screenerPresets,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(screenerPresets.create).not.toHaveBeenCalled();
  });

  it("resolves each field to metricKey/fieldKey before saving", async () => {
    const screenerPresets = fakeScreenerPresets({ create: vi.fn().mockResolvedValue({ ok: true, row: SAMPLE_ROW }) });

    await addPreset(
      "uid1",
      [
        { field: "roe.roeTtmPct", min: 30, max: null, exclude: false },
        { field: "grossMargin.grossMarginTtm", min: 60, max: null, exclude: false },
      ],
      undefined,
      undefined,
      { screenerPresets },
    );

    expect(screenerPresets.create).toHaveBeenCalledWith(
      "uid1",
      "未命名",
      [
        { metricKey: "roe", fieldKey: "roeTtmPct", min: 30, max: null, exclude: false },
        { metricKey: "grossMargin", fieldKey: "grossMarginTtm", min: 60, max: null, exclude: false },
      ],
      [],
      [],
    );
  });

  // Regression test: fields used to be validated one at a time (one query per filter), which multiplied
  // network round trips to the remote app DB by the filter count. Must be a single batched lookup.
  it("validates all filter fields in a single batched lookup, not one query per filter", async () => {
    const screenerPresets = fakeScreenerPresets({ create: vi.fn().mockResolvedValue({ ok: true, row: SAMPLE_ROW }) });

    await addPreset(
      "uid1",
      [
        { field: "roe.roeTtmPct", min: 30, max: null, exclude: false },
        { field: "grossMargin.grossMarginTtm", min: 60, max: null, exclude: false },
      ],
      undefined,
      undefined,
      { screenerPresets },
    );

    expect(findMetricFields).toHaveBeenCalledTimes(1);
    expect(findMetricFields).toHaveBeenCalledWith([
      { metricKey: "roe", fieldKey: "roeTtmPct" },
      { metricKey: "grossMargin", fieldKey: "grossMarginTtm" },
    ]);
  });

  it("falls back to '未命名 2' when '未命名' is already taken, instead of erroring", async () => {
    const screenerPresets = fakeScreenerPresets({
      list: vi.fn().mockResolvedValue([{ ...SAMPLE_ROW, name: "未命名" }]),
      create: vi.fn().mockResolvedValue({ ok: true, row: { ...SAMPLE_ROW, name: "未命名 2" } }),
    });

    const result = await addPreset(
      "uid1",
      [{ field: "roe.roeTtmPct", min: 30, max: null, exclude: false }],
      undefined,
      undefined,
      { screenerPresets },
    );

    expect(screenerPresets.create).toHaveBeenCalledWith(
      "uid1",
      "未命名 2",
      [{ metricKey: "roe", fieldKey: "roeTtmPct", min: 30, max: null, exclude: false }],
      [],
      [],
    );
    expect(result.name).toBe("未命名 2");
  });

  it("keeps incrementing past multiple taken suffixes ('未命名', '未命名 2', ... -> '未命名 3')", async () => {
    const screenerPresets = fakeScreenerPresets({
      list: vi.fn().mockResolvedValue([
        { ...SAMPLE_ROW, name: "未命名" },
        { ...SAMPLE_ROW, name: "未命名 2" },
      ]),
      create: vi.fn().mockResolvedValue({ ok: true, row: { ...SAMPLE_ROW, name: "未命名 3" } }),
    });

    await addPreset(
      "uid1",
      [{ field: "roe.roeTtmPct", min: 30, max: null, exclude: false }],
      undefined,
      undefined,
      { screenerPresets },
    );

    expect(screenerPresets.create).toHaveBeenCalledWith(
      "uid1",
      "未命名 3",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  // Regression: a stale name-availability check (checked once, then inserted) could still race with a
  // concurrent request grabbing the same name in between. The port reporting a duplicate must trigger a
  // retry, not surface as an error straight to the caller. Before the ports refactor this test had to
  // construct a PrismaClientKnownRequestError with code "P2002" — it proved the service understood one
  // driver's error taxonomy rather than proving the retry rule.
  it("retries with a fresh name pick if the insert itself reports a duplicate", async () => {
    const screenerPresets = fakeScreenerPresets({
      create: vi
        .fn()
        .mockResolvedValueOnce({ ok: false, reason: "duplicate" })
        .mockResolvedValueOnce({ ok: true, row: SAMPLE_ROW }),
    });

    const result = await addPreset(
      "uid1",
      [{ field: "roe.roeTtmPct", min: 30, max: null, exclude: false }],
      undefined,
      undefined,
      { screenerPresets },
    );

    expect(screenerPresets.create).toHaveBeenCalledTimes(2);
    expect(result.name).toBe(SAMPLE_ROW.name);
  });

  // Regression test: a prior version of addPreset auto-created a per-user ColumnPreset row and
  // pointed lastColumnPresetId at it. That materializes the default at creation time — a later change
  // to the default-resolution logic would then never reach already-created users. addPreset must leave
  // column presets alone entirely; the default is only ever resolved live at run time (see
  // resolveScreenerColumns in columnPresets.service.ts).
  it("never touches column presets — lastColumnPresetId stays whatever the port returns (usually null)", async () => {
    const screenerPresets = fakeScreenerPresets({ create: vi.fn().mockResolvedValue({ ok: true, row: SAMPLE_ROW }) });

    const result = await addPreset("uid1", [], undefined, undefined, { screenerPresets });

    expect(screenerPresets.setLastColumnPreset).not.toHaveBeenCalled();
    expect(result.lastColumnPresetId).toBe(SAMPLE_ROW.lastColumnPresetId);
  });
});

describe("editPreset", () => {
  it("allows replacing filters with an empty array", async () => {
    const screenerPresets = fakeScreenerPresets({
      update: vi.fn().mockResolvedValue({ ok: true, row: { ...SAMPLE_ROW, filters: [] } }),
    });

    await editPreset("uid1", SAMPLE_ID, { filters: [] }, { screenerPresets });

    expect(screenerPresets.update).toHaveBeenCalledWith("uid1", SAMPLE_ID, {
      name: undefined,
      filters: [],
      sectorCodes: undefined,
      excludeSectorCodes: undefined,
    });
  });

  it("throws 404 when the port reports no matching row", async () => {
    const screenerPresets = fakeScreenerPresets({
      update: vi.fn().mockResolvedValue({ ok: false, reason: "not-found" }),
    });

    await expect(editPreset("uid1", "missing-uuid", { name: "x" }, { screenerPresets })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  // Regression: a PATCH only sends the field(s) actually changing, so the route schema's mutual-
  // exclusivity refine can't see the row's existing sectorCodes — editPreset itself must clear the other
  // field when one is set to non-empty, or a partial update could leave both non-empty in the DB.
  it("clears sectorCodes when excludeSectorCodes is set to a non-empty array", async () => {
    const screenerPresets = fakeScreenerPresets({
      update: vi.fn().mockResolvedValue({ ok: true, row: { ...SAMPLE_ROW, excludeSectorCodes: ["24"] } }),
    });

    await editPreset("uid1", SAMPLE_ID, { excludeSectorCodes: ["24"] }, { screenerPresets });

    expect(screenerPresets.update).toHaveBeenCalledWith("uid1", SAMPLE_ID, {
      name: undefined,
      filters: undefined,
      sectorCodes: [],
      excludeSectorCodes: ["24"],
    });
  });

  it("clears excludeSectorCodes when sectorCodes is set to a non-empty array", async () => {
    const screenerPresets = fakeScreenerPresets({
      update: vi.fn().mockResolvedValue({ ok: true, row: { ...SAMPLE_ROW, sectorCodes: ["24"] } }),
    });

    await editPreset("uid1", SAMPLE_ID, { sectorCodes: ["24"] }, { screenerPresets });

    expect(screenerPresets.update).toHaveBeenCalledWith("uid1", SAMPLE_ID, {
      name: undefined,
      filters: undefined,
      sectorCodes: ["24"],
      excludeSectorCodes: [],
    });
  });

  it("leaves both untouched when neither sectorCodes nor excludeSectorCodes is given", async () => {
    const screenerPresets = fakeScreenerPresets({ update: vi.fn().mockResolvedValue({ ok: true, row: SAMPLE_ROW }) });

    await editPreset("uid1", SAMPLE_ID, { name: "renamed" }, { screenerPresets });

    expect(screenerPresets.update).toHaveBeenCalledWith("uid1", SAMPLE_ID, {
      name: "renamed",
      filters: undefined,
      sectorCodes: undefined,
      excludeSectorCodes: undefined,
    });
  });

  it("turns a duplicate name conflict into 409", async () => {
    const screenerPresets = fakeScreenerPresets({
      update: vi.fn().mockResolvedValue({ ok: false, reason: "duplicate" }),
    });

    await expect(editPreset("uid1", SAMPLE_ID, { name: "重複" }, { screenerPresets })).rejects.toMatchObject({
      statusCode: 409,
    });
  });
});

describe("getPresetOrThrow / removePreset", () => {
  it("getPresetOrThrow throws 404 when not found", async () => {
    const screenerPresets = fakeScreenerPresets({ find: vi.fn().mockResolvedValue(null) });
    await expect(getPresetOrThrow("uid1", "missing-uuid", { screenerPresets })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("removePreset throws 404 when nothing was deleted", async () => {
    const screenerPresets = fakeScreenerPresets({ remove: vi.fn().mockResolvedValue(false) });
    await expect(removePreset("uid1", "missing-uuid", { screenerPresets })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("reorderPresetsForUser", () => {
  it("passes the ordered ids straight through to the port and returns the reordered view", async () => {
    const screenerPresets = fakeScreenerPresets({
      reorder: vi.fn().mockResolvedValue([
        { ...SAMPLE_ROW, id: OTHER_ID, name: "轉機股" },
        { ...SAMPLE_ROW, id: SAMPLE_ID, name: "績優股" },
      ]),
    });

    const result = await reorderPresetsForUser("uid1", [OTHER_ID, SAMPLE_ID], { screenerPresets });

    expect(screenerPresets.reorder).toHaveBeenCalledWith("uid1", [OTHER_ID, SAMPLE_ID]);
    expect(result.map((r) => r.id)).toEqual([OTHER_ID, SAMPLE_ID]);
  });

  // The port returns null when `ids` isn't exactly the user's current full set — must surface as
  // a 400, not a 500 or a silent no-op.
  it("throws a 400 when the port reports ids don't match the user's current full set", async () => {
    const screenerPresets = fakeScreenerPresets({ reorder: vi.fn().mockResolvedValue(null) });

    await expect(reorderPresetsForUser("uid1", [SAMPLE_ID], { screenerPresets })).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});
