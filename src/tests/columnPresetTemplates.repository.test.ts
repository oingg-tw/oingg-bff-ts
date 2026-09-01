import { beforeEach, describe, expect, it, vi } from "vitest";

const mockTx = {
  $executeRaw: vi.fn(async () => 0),
  columnPresetTemplate: { deleteMany: vi.fn() },
};

const mockPrisma = {
  $transaction: vi.fn(async (callback: (tx: typeof mockTx) => Promise<void>) => callback(mockTx)),
  columnPresetTemplate: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
};

vi.mock("@/adapters/neon/index.js", () => ({
  getPrismaClient: () => mockPrisma,
}));

import {
  findColumnPresetTemplate,
  findDefaultColumnPresetTemplate,
  listColumnPresetTemplates,
  replaceColumnPresetTemplates,
} from "@/domains/columnPresetTemplates/columnPresetTemplates.repository.js";
import type { ColumnPresetTemplate } from "@/domains/columnPresetTemplates/columnPresetTemplates.types.js";

const SAMPLE_TEMPLATES: ColumnPresetTemplate[] = [
  {
    key: "overview",
    name: "總覽",
    description: "本益比、股價淨值比...",
    fieldKeys: ["per.peRatio", "pbr.pbRatio"],
    isDefault: true,
  },
  {
    key: "dividendIncome",
    name: "存股領息",
    description: "殖利率、配息穩定度...",
    fieldKeys: ["dividendYield.dividendYieldPct", "roe.roeTtmPct"],
    isDefault: false,
  },
  {
    key: "profitabilityQuality",
    name: "獲利品質拆解",
    description: "杜邦拆解 ROE...",
    fieldKeys: ["dupont.netProfitMarginQuarterly", "dupont.assetTurnoverQuarterly"],
    isDefault: false,
  },
];

describe("listColumnPresetTemplates", () => {
  beforeEach(() => {
    vi.mocked(mockPrisma.columnPresetTemplate.findMany).mockReset();
  });

  it("maps the stored fieldKeys JSON column and isDefault flag back onto the view", async () => {
    vi.mocked(mockPrisma.columnPresetTemplate.findMany).mockResolvedValue([
      {
        key: "dividendIncome",
        name: "存股領息",
        description: "test",
        fieldKeys: ["dividendYield.dividendYieldPct"],
        isDefault: false,
      },
    ] as never);

    const result = await listColumnPresetTemplates();

    expect(result).toEqual([
      {
        key: "dividendIncome",
        name: "存股領息",
        description: "test",
        fieldKeys: ["dividendYield.dividendYieldPct"],
        isDefault: false,
      },
    ]);
  });
});

describe("findColumnPresetTemplate", () => {
  beforeEach(() => {
    vi.mocked(mockPrisma.columnPresetTemplate.findUnique).mockReset();
  });

  it("returns null when not found", async () => {
    vi.mocked(mockPrisma.columnPresetTemplate.findUnique).mockResolvedValue(null);
    await expect(findColumnPresetTemplate("missing")).resolves.toBeNull();
  });
});

describe("findDefaultColumnPresetTemplate", () => {
  beforeEach(() => {
    vi.mocked(mockPrisma.columnPresetTemplate.findFirst).mockReset();
  });

  it("queries by isDefault: true rather than scanning the full list", async () => {
    vi.mocked(mockPrisma.columnPresetTemplate.findFirst).mockResolvedValue(null);

    await findDefaultColumnPresetTemplate();

    expect(mockPrisma.columnPresetTemplate.findFirst).toHaveBeenCalledWith({ where: { isDefault: true } });
  });

  // Regression-shaped: this is the fallback resolveScreenerColumns relies on when analysis-ts's sync
  // hasn't run yet (fresh DB, or the process just started and hasn't synced) — must return null cleanly,
  // not throw, so the caller can fall back to no columns instead of crashing the screener endpoint.
  it("returns null when no template is marked isDefault yet", async () => {
    vi.mocked(mockPrisma.columnPresetTemplate.findFirst).mockResolvedValue(null);
    await expect(findDefaultColumnPresetTemplate()).resolves.toBeNull();
  });
});

describe("replaceColumnPresetTemplates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Same rationale as replaceFilterCatalog: upsert by natural key (`key`) in one batched statement,
  // never delete-everything-then-recreate — even though nothing FKs into this table today, getting the
  // habit right avoids a silent trap the day something does.
  it("upserts via a single batched statement instead of wiping and recreating every row", async () => {
    await replaceColumnPresetTemplates(SAMPLE_TEMPLATES);

    expect(mockTx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("only deletes rows that are genuinely absent from the new list, not the whole table", async () => {
    await replaceColumnPresetTemplates(SAMPLE_TEMPLATES);

    expect(mockTx.columnPresetTemplate.deleteMany).toHaveBeenCalledWith({
      where: { key: { notIn: ["overview", "dividendIncome", "profitabilityQuality"] } },
    });
  });

  it("deletes everything when the new list is empty, instead of leaving stale rows behind", async () => {
    await replaceColumnPresetTemplates([]);

    expect(mockTx.$executeRaw).not.toHaveBeenCalled();
    expect(mockTx.columnPresetTemplate.deleteMany).toHaveBeenCalledWith({ where: { key: { notIn: [] } } });
  });
});
