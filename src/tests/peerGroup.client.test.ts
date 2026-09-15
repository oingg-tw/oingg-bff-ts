import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchPeerGroup } from "@/domainBff/stock/peerGroup.client.js";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_FILTERS_URL = process.env.FILTERS_SERVICE_URL;

beforeEach(() => {
  process.env.FILTERS_SERVICE_URL = "http://filters.test";
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_FILTERS_URL === undefined) {
    delete process.env.FILTERS_SERVICE_URL;
  } else {
    process.env.FILTERS_SERVICE_URL = ORIGINAL_FILTERS_URL;
  }
});

function mockFetchOnce(response: { ok: boolean; status?: number; body: unknown }) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? 200,
    json: () => Promise.resolve(response.body),
  }) as unknown as typeof fetch;
}

// Real shape given directly by analysis-ts (2026-09-15: peer-selection algorithm rewrite —
// classificationLevel/industryCode/industryName replaced by peerGroupLevel/peerGroupNodeId/
// peerGroupLabel + notFoundReason; category/coarseGroup demoted to informational tags).
const RAW_BODY = {
  symbol: "2330",
  companyName: "台積電",
  found: true,
  notFoundReason: null,
  peerGroupLevel: "segment",
  peerGroupNodeId: "電子零組件與半導體/積體電路/0/0",
  peerGroupLabel: "晶圓代工與主流封測",
  category: "積體電路",
  coarseGroup: "電子零組件與半導體",
  source: "gemini",
  updatedAt: "2026-09-14",
  peers: [
    { symbol: "2330", companyName: "台積電" },
    { symbol: "2454", companyName: "聯發科" },
  ],
  warnings: [],
};

describe("fetchPeerGroup", () => {
  it("requests /companies/peer-group?symbol= with no other params by default", async () => {
    mockFetchOnce({ ok: true, body: RAW_BODY });

    const result = await fetchPeerGroup("2330");

    expect(result).toEqual(RAW_BODY);
    const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(url.toString()).toBe("http://filters.test/companies/peer-group?symbol=2330");
  });

  it("includes minPeers when given", async () => {
    mockFetchOnce({ ok: true, body: RAW_BODY });

    await fetchPeerGroup("2330", { minPeers: 50 });

    const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(url.toString()).toBe("http://filters.test/companies/peer-group?symbol=2330&minPeers=50");
  });

  // Confirmed live: minPeers=50 falls back from segment to category level, with an explanatory warning.
  it("passes through warnings and a category-level fallback", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        ...RAW_BODY,
        peerGroupLevel: "category",
        peerGroupNodeId: "電子零組件與半導體/積體電路",
        peerGroupLabel: "積體電路",
        warnings: ["同業數在產業內區隔層級不足 50 家，已回退到整個產業層級（積體電路），同業裡可能包含上下游位置不同的公司，請自行判斷比較的參考價值。"],
      },
    });

    const result = await fetchPeerGroup("2330", { minPeers: 50 });

    expect(result.peerGroupLevel).toBe("category");
    expect(result.peerGroupLabel).toBe("積體電路");
    expect(result.warnings).toHaveLength(1);
  });

  // category/coarseGroup are downgraded to purely informational tags as of 2026-09-15 — must still pass
  // through even when they differ from the level actually used for this comparison (peerGroupLevel).
  it("passes through category/coarseGroup as informational tags independent of peerGroupLevel", async () => {
    mockFetchOnce({ ok: true, body: RAW_BODY });

    const result = await fetchPeerGroup("2330");

    expect(result.category).toBe("積體電路");
    expect(result.coarseGroup).toBe("電子零組件與半導體");
    expect(result.peerGroupLevel).toBe("segment");
  });

  // source replaced confidence/sampleSize 2026-09-15 — must survive normalization as-is.
  it("passes through source: keyword for the minority classified by keyword rules alone", async () => {
    mockFetchOnce({ ok: true, body: { ...RAW_BODY, source: "keyword" } });

    const result = await fetchPeerGroup("2330");

    expect(result.source).toBe("keyword");
  });

  // Confirmed live: an unclassified symbol is still a 200, found:false, notFoundReason:"not_classified".
  it("returns found:false with notFoundReason:not_classified for an unknown symbol, without throwing", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        symbol: "NOPE9999",
        companyName: null,
        found: false,
        notFoundReason: "not_classified",
        peerGroupLevel: null,
        peerGroupNodeId: null,
        peerGroupLabel: null,
        category: null,
        coarseGroup: null,
        source: null,
        updatedAt: null,
        peers: [],
        warnings: [],
      },
    });

    const result = await fetchPeerGroup("NOPE9999");

    expect(result).toEqual({
      symbol: "NOPE9999",
      companyName: null,
      found: false,
      notFoundReason: "not_classified",
      peerGroupLevel: null,
      peerGroupNodeId: null,
      peerGroupLabel: null,
      category: null,
      coarseGroup: null,
      source: null,
      updatedAt: null,
      peers: [],
      warnings: [],
    });
  });

  // A classified symbol can still fail minPeers even at the tree's root — this is a genuine found:false
  // now (2026-09-15 rewrite), not a forced coarse-level result like before.
  it("returns found:false with notFoundReason:insufficient_peers when even the root level can't meet minPeers", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        symbol: "1234",
        companyName: "冷門公司",
        found: false,
        notFoundReason: "insufficient_peers",
        peerGroupLevel: null,
        peerGroupNodeId: null,
        peerGroupLabel: null,
        category: "某冷門分類",
        coarseGroup: "某粗分類",
        source: "gemini",
        updatedAt: "2026-09-14",
        peers: [],
        warnings: [],
      },
    });

    const result = await fetchPeerGroup("1234", { minPeers: 999 });

    expect(result.found).toBe(false);
    expect(result.notFoundReason).toBe("insufficient_peers");
    // Informational tags can still be present even when found is false for this reason.
    expect(result.category).toBe("某冷門分類");
  });

  it("relays analysis-ts's 400 message for an invalid query param", async () => {
    mockFetchOnce({ ok: false, status: 400, body: { message: '"minPeers" must be a number' } });

    await expect(fetchPeerGroup("2330", { minPeers: Number.NaN })).rejects.toMatchObject({
      statusCode: 400,
      message: '"minPeers" must be a number',
    });
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchPeerGroup("2330")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError for a non-400 non-2xx status", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchPeerGroup("2330")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response is missing expected fields", async () => {
    mockFetchOnce({ ok: true, body: { symbol: "2330" } });

    await expect(fetchPeerGroup("2330")).rejects.toMatchObject({ statusCode: 502 });
  });
});
