import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/application/proxy/screener/screener.service.js", () => ({
  runScreener: vi.fn(),
}));

// Still a module mock, not a port fake: resolveScreenerColumns is a *use case* of a neighbouring slice,
// not a dependency this one owns. runPreset's whole job is the orchestration order around it (what runs
// concurrently, when the last-used column preset is written back), so these tests need to control what
// it returns and observe exactly what it was called with. The preset storage below, by contrast, is a
// port and is faked as one.
vi.mock("@/application/screener/columnPresets.service.js", () => ({
  resolveScreenerColumns: vi.fn(),
}));

import { resolveScreenerColumns } from "@/application/screener/columnPresets.service.js";
import { runPreset } from "@/application/proxy/screener/runPreset.js";
import { runScreener } from "@/application/proxy/screener/screener.service.js";
import { fakeScreenerGateway, fakeStockGateway } from "@/tests/fakes/analysisGateways.js";
import { fakeColumnPresets } from "@/tests/fakes/columnPresets.js";
import { fakeMetricCatalog } from "@/tests/fakes/metricCatalog.js";
import { fakeColumnPresetTemplates } from "@/tests/fakes/presetTemplates.js";
import { fakeScreenerPresets } from "@/tests/fakes/screenerPresets.js";
import type { ScreenerPresetsPort } from "@/application/ports/screenerPresets.js";

const SAMPLE_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const COLUMN_PRESET_ID = "bbbbbbbb-0000-4000-8000-000000000007";
const OTHER_COLUMN_PRESET_ID = "bbbbbbbb-0000-4000-8000-000000000009";

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

const SAMPLE_SCREENER_RESULT = {
  count: 1,
  page: 1,
  pageSize: 50,
  totalPages: 1,
  columns: [{ field: "per.peRatio", metricName: "本益比 PER", fieldName: "本益比 PER", unit: "times" }],
  results: [{ symbol: "2330", name: "台積電", values: { "per.peRatio": { value: "27.82", knowledgeDate: "2026-08-28", nullReason: null, formulaVersion: 1 } } }],
};

const DEFAULT_PAGINATION = { page: 1, pageSize: 50 };

/**
 * runPreset needs both business slices' ports plus the proxy's own (see RunPresetDeps) — only the preset
 * one is ever varied. The screener gateway, metric catalog and stock gateway are in here purely to
 * satisfy the type: runScreener itself is module-mocked above, so nothing in these tests ever reaches them.
 */
function depsWith(screenerPresets: ScreenerPresetsPort) {
  return {
    screenerPresets,
    columnPresets: fakeColumnPresets(),
    columnPresetTemplates: fakeColumnPresetTemplates(),
    screenerGateway: fakeScreenerGateway(),
    metricCatalog: fakeMetricCatalog(),
    stockGateway: fakeStockGateway(),
  };
}

beforeEach(() => {
  vi.mocked(runScreener).mockReset();
  vi.mocked(resolveScreenerColumns).mockReset();
});

describe("runPreset", () => {
  it("throws 404 when the preset doesn't exist for this user", async () => {
    const deps = depsWith(fakeScreenerPresets({ find: vi.fn().mockResolvedValue(null) }));

    await expect(runPreset("uid1", "missing-uuid", DEFAULT_PAGINATION, undefined, undefined, deps)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(runScreener).not.toHaveBeenCalled();
  });

  it("with no columnPresetId and no last-used one, resolves columns with undefined (falls to user default/system default)", async () => {
    const deps = depsWith(fakeScreenerPresets({ find: vi.fn().mockResolvedValue(SAMPLE_ROW) }));
    vi.mocked(resolveScreenerColumns).mockResolvedValue({
      columnPresetId: null,
      columns: [{ field: "per.peRatio" }],
    });
    vi.mocked(runScreener).mockResolvedValue(SAMPLE_SCREENER_RESULT);

    const result = await runPreset("uid1", SAMPLE_ID, DEFAULT_PAGINATION, undefined, undefined, deps);

    expect(resolveScreenerColumns).toHaveBeenCalledWith("uid1", undefined, deps);
    expect(deps.screenerPresets.setLastColumnPreset).not.toHaveBeenCalled();
    expect(runScreener).toHaveBeenCalledWith(
      [
        { field: "roe.roeTtmPct", min: 30, max: null, exclude: false },
        { field: "grossMargin.grossMarginTtm", min: 60, max: null, exclude: false },
      ],
      [{ field: "per.peRatio" }],
      DEFAULT_PAGINATION,
      undefined,
      [],
      [],
      deps,
    );
    expect(result.preset.name).toBe("績優股");
    expect(result.columnPresetId).toBeNull();
  });

  it("with no explicit columnPresetId, falls back to the preset's last-used column preset", async () => {
    const deps = depsWith(
      fakeScreenerPresets({ find: vi.fn().mockResolvedValue({ ...SAMPLE_ROW, lastColumnPresetId: COLUMN_PRESET_ID }) }),
    );
    vi.mocked(resolveScreenerColumns).mockResolvedValue({ columnPresetId: COLUMN_PRESET_ID, columns: [] });
    vi.mocked(runScreener).mockResolvedValue(SAMPLE_SCREENER_RESULT);

    await runPreset("uid1", SAMPLE_ID, DEFAULT_PAGINATION, undefined, undefined, deps);

    expect(resolveScreenerColumns).toHaveBeenCalledWith("uid1", COLUMN_PRESET_ID, deps);
    expect(deps.screenerPresets.setLastColumnPreset).not.toHaveBeenCalled();
  });

  it("with an explicit columnPresetId, uses it and remembers it as the preset's new last-used column preset", async () => {
    const deps = depsWith(
      fakeScreenerPresets({ find: vi.fn().mockResolvedValue({ ...SAMPLE_ROW, lastColumnPresetId: COLUMN_PRESET_ID }) }),
    );
    vi.mocked(resolveScreenerColumns).mockResolvedValue({ columnPresetId: OTHER_COLUMN_PRESET_ID, columns: [] });
    vi.mocked(runScreener).mockResolvedValue(SAMPLE_SCREENER_RESULT);

    const result = await runPreset("uid1", SAMPLE_ID, DEFAULT_PAGINATION, OTHER_COLUMN_PRESET_ID, undefined, deps);

    expect(resolveScreenerColumns).toHaveBeenCalledWith("uid1", OTHER_COLUMN_PRESET_ID, deps);
    expect(deps.screenerPresets.setLastColumnPreset).toHaveBeenCalledWith("uid1", SAMPLE_ID, OTHER_COLUMN_PRESET_ID);
    expect(result.columnPresetId).toBe(OTHER_COLUMN_PRESET_ID);
  });

  it("forwards page/pageSize through to runScreener", async () => {
    const deps = depsWith(fakeScreenerPresets({ find: vi.fn().mockResolvedValue(SAMPLE_ROW) }));
    vi.mocked(resolveScreenerColumns).mockResolvedValue({ columnPresetId: null, columns: [] });
    vi.mocked(runScreener).mockResolvedValue(SAMPLE_SCREENER_RESULT);

    await runPreset("uid1", SAMPLE_ID, { page: 2, pageSize: 10 }, undefined, undefined, deps);

    expect(runScreener).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { page: 2, pageSize: 10 },
      undefined,
      [],
      [],
      deps,
    );
  });

  // Perf regression test (2026-09-01): every call that repeats the same explicit columnPresetId as last
  // time (e.g. paging through the same view) used to fire a write that changed nothing. Skip it when the
  // resolved columnPresetId already matches what's on file.
  it("skips setLastColumnPreset when the explicit columnPresetId is already the preset's last-used one", async () => {
    const deps = depsWith(
      fakeScreenerPresets({ find: vi.fn().mockResolvedValue({ ...SAMPLE_ROW, lastColumnPresetId: COLUMN_PRESET_ID }) }),
    );
    vi.mocked(resolveScreenerColumns).mockResolvedValue({ columnPresetId: COLUMN_PRESET_ID, columns: [] });
    vi.mocked(runScreener).mockResolvedValue(SAMPLE_SCREENER_RESULT);

    await runPreset("uid1", SAMPLE_ID, DEFAULT_PAGINATION, COLUMN_PRESET_ID, undefined, deps);

    expect(deps.screenerPresets.setLastColumnPreset).not.toHaveBeenCalled();
  });

  // Perf regression test (2026-09-01): when columnPresetId is given explicitly, resolving it doesn't
  // need the preset's own result (lastColumnPresetId) at all, so the two lookups run concurrently instead
  // of sequentially. Verified by checking both mocks are *called* before either one *resolves*.
  it("runs the preset lookup and resolveScreenerColumns concurrently when columnPresetId is given explicitly", async () => {
    let resolveFind!: (value: unknown) => void;
    let resolveColumns!: (value: Awaited<ReturnType<typeof resolveScreenerColumns>>) => void;
    const find = vi.fn().mockReturnValue(new Promise((resolve) => (resolveFind = resolve)));
    const deps = depsWith(fakeScreenerPresets({ find }));
    vi.mocked(resolveScreenerColumns).mockReturnValue(new Promise((resolve) => (resolveColumns = resolve)));
    vi.mocked(runScreener).mockResolvedValue(SAMPLE_SCREENER_RESULT);

    const resultPromise = runPreset("uid1", SAMPLE_ID, DEFAULT_PAGINATION, COLUMN_PRESET_ID, undefined, deps);

    await new Promise((resolve) => setImmediate(resolve));
    expect(find).toHaveBeenCalled();
    expect(resolveScreenerColumns).toHaveBeenCalledWith("uid1", COLUMN_PRESET_ID, deps);

    resolveFind({ ...SAMPLE_ROW, lastColumnPresetId: COLUMN_PRESET_ID });
    resolveColumns({ columnPresetId: COLUMN_PRESET_ID, columns: [] });
    await resultPromise;
  });
});
