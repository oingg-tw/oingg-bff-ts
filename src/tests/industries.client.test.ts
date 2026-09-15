import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchChainClassification,
  fetchChainClusters,
  fetchChainTree,
  fetchIndustryFlatList,
  fetchIndustryTree,
  fetchSecuritiesSectors,
} from "@/domainBff/industries/industries.client.js";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_FILTERS_URL = process.env.FILTERS_SERVICE_URL;
const ORIGINAL_BFF_API_KEY = process.env.BFF_API_KEY;

beforeEach(() => {
  process.env.FILTERS_SERVICE_URL = "http://filters.test";
  process.env.BFF_API_KEY = "test-key";
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_FILTERS_URL === undefined) {
    delete process.env.FILTERS_SERVICE_URL;
  } else {
    process.env.FILTERS_SERVICE_URL = ORIGINAL_FILTERS_URL;
  }
  if (ORIGINAL_BFF_API_KEY === undefined) {
    delete process.env.BFF_API_KEY;
  } else {
    process.env.BFF_API_KEY = ORIGINAL_BFF_API_KEY;
  }
});

function mockFetchOnce(response: { ok: boolean; status?: number; body: unknown }) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? 200,
    json: () => Promise.resolve(response.body),
  }) as unknown as typeof fetch;
}

const ROOT_RESPONSE = {
  found: true,
  code: null,
  level: null,
  name: null,
  companyCount: 999,
  children: [
    { code: "A", level: "section", name: "農、林、漁、牧業", companyCount: 4, hasChildren: true },
    { code: "O", level: "section", name: "公共行政及國防；強制性社會安全", companyCount: 0, hasChildren: true },
  ],
  companies: [],
};

const LEAF_RESPONSE = {
  found: true,
  code: "2711-00",
  level: "subclass",
  name: "電腦製造業",
  companyCount: 18,
  children: [],
  companies: [{ symbol: "2317", companyName: "鴻海" }],
};

const NOT_FOUND_RESPONSE = {
  found: false,
  code: "ZZZZ-NOPE",
  level: null,
  name: null,
  companyCount: 0,
  children: [],
  companies: [],
};

describe("fetchIndustryTree", () => {
  it("requests /industries/tree without a code param when omitted, and normalizes the root response", async () => {
    mockFetchOnce({ ok: true, body: ROOT_RESPONSE });

    const result = await fetchIndustryTree();

    expect(result).toEqual(ROOT_RESPONSE);
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/industries/tree");
  });

  // hasChildren can be true even when companyCount is 0 — the dictionary has children even if no
  // tracked company currently falls under this node. Normalization must preserve this, not collapse it.
  it("preserves a zero companyCount alongside hasChildren: true", async () => {
    mockFetchOnce({ ok: true, body: ROOT_RESPONSE });

    const result = await fetchIndustryTree();

    const empty = result.children.find((c) => c.code === "O");
    expect(empty).toEqual({ code: "O", level: "section", name: "公共行政及國防；強制性社會安全", companyCount: 0, hasChildren: true });
  });

  it("requests /industries/tree?code= with the given code and normalizes a leaf (subclass) response", async () => {
    mockFetchOnce({ ok: true, body: LEAF_RESPONSE });

    const result = await fetchIndustryTree("2711-00");

    expect(result).toEqual(LEAF_RESPONSE);
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/industries/tree?code=2711-00");
  });

  it("returns found:false for an unknown code, without throwing", async () => {
    mockFetchOnce({ ok: true, body: NOT_FOUND_RESPONSE });

    await expect(fetchIndustryTree("ZZZZ-NOPE")).resolves.toEqual(NOT_FOUND_RESPONSE);
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchIndustryTree("C")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError for a non-2xx status", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchIndustryTree("C")).rejects.toMatchObject({ statusCode: 502 });
  });

  it('throws a 502 AppError when the response is missing a boolean "found" field', async () => {
    mockFetchOnce({ ok: true, body: { code: "C" } });

    await expect(fetchIndustryTree("C")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when a child has an unrecognized level", async () => {
    mockFetchOnce({
      ok: true,
      body: { ...ROOT_RESPONSE, children: [{ code: "X", level: "not-a-real-level", name: "x", companyCount: 1, hasChildren: false }] },
    });

    await expect(fetchIndustryTree()).rejects.toMatchObject({ statusCode: 502 });
  });
});

// Real entry given directly by analysis-ts (2026-09-09).
const FLAT_LIST_RESPONSE = {
  companies: [
    {
      symbol: "2330",
      companyName: "台積電",
      path: [
        { code: "C", level: "section", name: "製造業" },
        { code: "26", level: "division", name: "電子零組件製造業" },
        { code: "261", level: "group", name: "半導體製造業" },
        { code: "2611", level: "class", name: "積體電路製造業" },
        { code: "2611-99", level: "subclass", name: "其他積體電路製造" },
      ],
    },
  ],
};

describe("fetchIndustryFlatList", () => {
  it("requests /industries/flat with no query params and normalizes the response", async () => {
    mockFetchOnce({ ok: true, body: FLAT_LIST_RESPONSE });

    const result = await fetchIndustryFlatList();

    expect(result).toEqual(FLAT_LIST_RESPONSE);
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/industries/flat");
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchIndustryFlatList()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError for a non-2xx status", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchIndustryFlatList()).rejects.toMatchObject({ statusCode: 502 });
  });

  it('throws a 502 AppError when the response is missing a "companies" array', async () => {
    mockFetchOnce({ ok: true, body: { oops: true } });

    await expect(fetchIndustryFlatList()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when a company's path has an unrecognized level", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        companies: [
          { symbol: "2330", companyName: "台積電", path: [{ code: "X", level: "not-a-real-level", name: "x" }] },
        ],
      },
    });

    await expect(fetchIndustryFlatList()).rejects.toMatchObject({ statusCode: 502 });
  });
});

// Real shape given directly by analysis-ts (2026-09-11).
const SECTORS_RESPONSE = {
  sectors: [
    { code: "01", name: "水泥工業", companyCount: 8 },
    { code: "24", name: "半導體業", companyCount: 240 },
  ],
};

describe("fetchSecuritiesSectors", () => {
  it("requests /industries/securities-sectors with no query params and normalizes the response", async () => {
    mockFetchOnce({ ok: true, body: SECTORS_RESPONSE });

    const result = await fetchSecuritiesSectors();

    expect(result).toEqual(SECTORS_RESPONSE);
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/industries/securities-sectors");
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchSecuritiesSectors()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError for a non-2xx status", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchSecuritiesSectors()).rejects.toMatchObject({ statusCode: 502 });
  });

  it('throws a 502 AppError when the response is missing a "sectors" array', async () => {
    mockFetchOnce({ ok: true, body: { oops: true } });

    await expect(fetchSecuritiesSectors()).rejects.toMatchObject({ statusCode: 502 });
  });
});

// Real shape given directly by analysis-ts (2026-09-14; confidence/sampleSize replaced by source 2026-09-15).
const CHAIN_CLASSIFICATION_RESPONSE = {
  companies: [
    { symbol: "1101", companyName: "台泥", category: "水泥建材", coarseGroup: "工業材料與設備", source: "gemini", updatedAt: "2026-09-14" },
    { symbol: "9999", companyName: "未分類公司", category: null, coarseGroup: null, source: null, updatedAt: null },
  ],
  groups: [
    { coarseGroup: "工業材料與設備", fineCategories: ["化學塑膠材料", "工業自動化", "水泥建材", "紙業包裝材料", "鋼鐵金屬材料"] },
  ],
};

describe("fetchChainClassification", () => {
  it("requests /industries/chain-classification with no query params and normalizes companies/groups", async () => {
    mockFetchOnce({ ok: true, body: CHAIN_CLASSIFICATION_RESPONSE });

    const result = await fetchChainClassification();

    expect(result).toEqual(CHAIN_CLASSIFICATION_RESPONSE);
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/industries/chain-classification");
  });

  // A null category must survive as null, not be filtered out or coerced into a placeholder string.
  it("keeps a null category/coarseGroup/source/updatedAt for an unclassified company", async () => {
    mockFetchOnce({ ok: true, body: CHAIN_CLASSIFICATION_RESPONSE });

    const result = await fetchChainClassification();

    expect(result.companies[1]).toEqual({
      symbol: "9999",
      companyName: "未分類公司",
      category: null,
      coarseGroup: null,
      source: null,
      updatedAt: null,
    });
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchChainClassification()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError for a non-2xx status", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchChainClassification()).rejects.toMatchObject({ statusCode: 502 });
  });

  it('throws a 502 AppError when the response is missing "companies"/"groups" arrays', async () => {
    mockFetchOnce({ ok: true, body: { oops: true } });

    await expect(fetchChainClassification()).rejects.toMatchObject({ statusCode: 502 });
  });
});

// Real shape given directly by analysis-ts (2026-09-14).
const CHAIN_CLUSTERS_RESPONSE = {
  clusters: [
    {
      clusterId: 0,
      label: "證券金融與資安雲端",
      metaGroup: "金融服務",
      directMembers: [],
      subClusters: [
        {
          subClusterId: 0,
          subLabel: "期貨與證券商",
          members: [
            { code: "5201", name: "凱衛", isListed: true },
            { code: "citigroupinc", name: "花旗集團（Citigroup Inc）", isListed: false },
          ],
        },
      ],
    },
    {
      clusterId: 1,
      label: "小型獨立聚落",
      metaGroup: null,
      directMembers: [{ code: "9999", name: "測試公司", isListed: true }],
      subClusters: [],
    },
  ],
};

describe("fetchChainClusters", () => {
  it("requests /industries/chain-clusters with no query params and normalizes the full tree", async () => {
    mockFetchOnce({ ok: true, body: CHAIN_CLUSTERS_RESPONSE });

    const result = await fetchChainClusters();

    expect(result).toEqual(CHAIN_CLUSTERS_RESPONSE);
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/industries/chain-clusters");
  });

  // isListed:false marks an international supply-chain node (e.g. Citigroup) with no stock-detail page —
  // must survive normalization exactly, not be coerced to true or dropped.
  it("preserves isListed:false for a non-listed international node", async () => {
    mockFetchOnce({ ok: true, body: CHAIN_CLUSTERS_RESPONSE });

    const result = await fetchChainClusters();

    expect(result.clusters[0]?.subClusters[0]?.members[1]).toEqual({
      code: "citigroupinc",
      name: "花旗集團（Citigroup Inc）",
      isListed: false,
    });
  });

  // A small top-level cluster (<=100 nodes) can skip sub-clustering entirely — members live directly on
  // the cluster instead of under subClusters.
  it("handles a top-level cluster with directMembers and no subClusters", async () => {
    mockFetchOnce({ ok: true, body: CHAIN_CLUSTERS_RESPONSE });

    const result = await fetchChainClusters();

    expect(result.clusters[1]).toEqual({
      clusterId: 1,
      label: "小型獨立聚落",
      metaGroup: null,
      directMembers: [{ code: "9999", name: "測試公司", isListed: true }],
      subClusters: [],
    });
  });

  // metaGroup added 2026-09-15 — must survive normalization, both present and null.
  it("passes through metaGroup, present or null", async () => {
    mockFetchOnce({ ok: true, body: CHAIN_CLUSTERS_RESPONSE });

    const result = await fetchChainClusters();

    expect(result.clusters[0]?.metaGroup).toBe("金融服務");
    expect(result.clusters[1]?.metaGroup).toBeNull();
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchChainClusters()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError for a non-2xx status", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchChainClusters()).rejects.toMatchObject({ statusCode: 502 });
  });

  it('throws a 502 AppError when the response is missing a "clusters" array', async () => {
    mockFetchOnce({ ok: true, body: { oops: true } });

    await expect(fetchChainClusters()).rejects.toMatchObject({ statusCode: 502 });
  });
});

// Real shape given directly by analysis-ts (2026-09-15).
const CHAIN_TREE_RESPONSE = {
  roots: [
    {
      nodeId: "電子零組件與半導體",
      nodeType: "coarse_group",
      label: "電子零組件與半導體",
      depth: 0,
      size: 406,
      children: [
        {
          nodeId: "電子零組件與半導體/積體電路",
          nodeType: "category",
          label: "積體電路",
          depth: 1,
          size: 152,
          children: [],
          members: [
            { symbol: "2330", companyName: "台積電" },
            { symbol: "2303", companyName: "聯電" },
          ],
        },
      ],
      members: [],
    },
    {
      nodeId: "其他",
      nodeType: "misc",
      label: "其他",
      depth: 0,
      size: 1,
      children: [],
      members: [{ symbol: "9999", companyName: "測試公司" }],
    },
  ],
};

describe("fetchChainTree", () => {
  it("requests /industries/chain-tree with no query params and normalizes the full tree", async () => {
    mockFetchOnce({ ok: true, body: CHAIN_TREE_RESPONSE });

    const result = await fetchChainTree();

    expect(result).toEqual(CHAIN_TREE_RESPONSE);
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/industries/chain-tree");
  });

  // members is only meaningful on a leaf node (empty children) — a non-leaf node's members must survive
  // as an empty array, not be dropped or coerced to null.
  it("keeps an empty members array on a non-leaf node and populates it on a leaf node", async () => {
    mockFetchOnce({ ok: true, body: CHAIN_TREE_RESPONSE });

    const result = await fetchChainTree();

    expect(result.roots[0]?.members).toEqual([]);
    expect(result.roots[0]?.children[0]?.members).toEqual([
      { symbol: "2330", companyName: "台積電" },
      { symbol: "2303", companyName: "聯電" },
    ]);
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchChainTree()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError for a non-2xx status", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchChainTree()).rejects.toMatchObject({ statusCode: 502 });
  });

  it('throws a 502 AppError when the response is missing a "roots" array', async () => {
    mockFetchOnce({ ok: true, body: { oops: true } });

    await expect(fetchChainTree()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when a node has an unrecognized nodeType", async () => {
    mockFetchOnce({
      ok: true,
      body: { roots: [{ nodeId: "x", nodeType: "not-a-real-type", label: "x", depth: 0, size: 1, children: [], members: [] }] },
    });

    await expect(fetchChainTree()).rejects.toMatchObject({ statusCode: 502 });
  });
});

