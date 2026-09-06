import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/domains/screener/screenerPresets.repository.js", () => ({
  findPreset: vi.fn(),
  setLastColumnPreset: vi.fn(),
}));

vi.mock("@/domains/screener/screener.service.js", () => ({
  runScreener: vi.fn(),
}));

vi.mock("@/domains/screener/columnPresets.service.js", () => ({
  resolveScreenerColumns: vi.fn(),
}));

import { resolveScreenerColumns } from "@/domains/screener/columnPresets.service.js";
import { runPreset } from "@/domains/screener/runPreset.js";
import { findPreset, setLastColumnPreset } from "@/domains/screener/screenerPresets.repository.js";
import { runScreener } from "@/domains/screener/screener.service.js";

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

const SAMPLE_SCREENER_RESULT = {
  count: 1,
  page: 1,
  pageSize: 50,
  totalPages: 1,
  columns: [{ field: "per.peRatio", metricName: "本益比 PER", fieldName: "本益比 PER", unit: "times" }],
  results: [{ symbol: "2330", name: "台積電", values: { "per.peRatio": { value: "27.82", asOfDate: "2026-08-28" } } }],
};

const DEFAULT_PAGINATION = { page: 1, pageSize: 50 };

beforeEach(() => {
  vi.mocked(findPreset).mockReset();
  vi.mocked(setLastColumnPreset).mockReset();
  vi.mocked(runScreener).mockReset();
  vi.mocked(resolveScreenerColumns).mockReset();
});

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
      undefined,
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

    expect(runScreener).toHaveBeenCalledWith(expect.anything(), expect.anything(), { page: 2, pageSize: 10 }, undefined);
  });

  // Perf regression test (2026-09-01): every call that repeats the same explicit columnPresetId as last
  // time (e.g. paging through the same view) used to fire a write that changed nothing. Skip it when the
  // resolved columnPresetId already matches what's on file.
  it("skips setLastColumnPreset when the explicit columnPresetId is already the preset's last-used one", async () => {
    vi.mocked(findPreset).mockResolvedValue({ ...SAMPLE_ROW, lastColumnPresetId: COLUMN_PRESET_ID });
    vi.mocked(resolveScreenerColumns).mockResolvedValue({ columnPresetId: COLUMN_PRESET_ID, columns: [] });
    vi.mocked(runScreener).mockResolvedValue(SAMPLE_SCREENER_RESULT);

    await runPreset("uid1", SAMPLE_ID, DEFAULT_PAGINATION, COLUMN_PRESET_ID);

    expect(setLastColumnPreset).not.toHaveBeenCalled();
  });

  // Perf regression test (2026-09-01): when columnPresetId is given explicitly, resolving it doesn't
  // need the preset's own result (lastColumnPresetId) at all, so the two lookups run concurrently instead
  // of sequentially. Verified by checking both mocks are *called* before either one *resolves*.
  it("runs findPreset and resolveScreenerColumns concurrently when columnPresetId is given explicitly", async () => {
    let resolveFindPreset!: (value: Awaited<ReturnType<typeof findPreset>>) => void;
    let resolveColumns!: (value: Awaited<ReturnType<typeof resolveScreenerColumns>>) => void;
    vi.mocked(findPreset).mockReturnValue(new Promise((resolve) => (resolveFindPreset = resolve)));
    vi.mocked(resolveScreenerColumns).mockReturnValue(new Promise((resolve) => (resolveColumns = resolve)));
    vi.mocked(runScreener).mockResolvedValue(SAMPLE_SCREENER_RESULT);

    const resultPromise = runPreset("uid1", SAMPLE_ID, DEFAULT_PAGINATION, COLUMN_PRESET_ID);

    await new Promise((resolve) => setImmediate(resolve));
    expect(findPreset).toHaveBeenCalled();
    expect(resolveScreenerColumns).toHaveBeenCalledWith("uid1", COLUMN_PRESET_ID);

    resolveFindPreset({ ...SAMPLE_ROW, lastColumnPresetId: COLUMN_PRESET_ID });
    resolveColumns({ columnPresetId: COLUMN_PRESET_ID, columns: [] });
    await resultPromise;
  });
});
