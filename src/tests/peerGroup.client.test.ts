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

// Real shape given directly by analysis-ts (2026-09-14).
const RAW_BODY = {
  symbol: "2330",
  companyName: "台積電",
  found: true,
  classificationLevel: "category",
  industryCode: "積體電路",
  industryName: "積體電路",
  confidence: 0.9079,
  sampleSize: 76,
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

  it("includes minPeers/minConfidence/minSampleSize when given", async () => {
    mockFetchOnce({ ok: true, body: RAW_BODY });

    await fetchPeerGroup("2330", { minPeers: 5, minConfidence: 0.8, minSampleSize: 10 });

    const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(url.toString()).toBe(
      "http://filters.test/companies/peer-group?symbol=2330&minPeers=5&minConfidence=0.8&minSampleSize=10",
    );
  });

  // Confirmed live: falling back from category to coarseGroup carries an explanatory warning.
  it("passes through warnings and a coarseGroup fallback level", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        ...RAW_BODY,
        classificationLevel: "coarseGroup",
        warnings: ["同業數在較細的分類下不足，已回退到更粗的分類層級。"],
      },
    });

    const result = await fetchPeerGroup("2330", { minSampleSize: 1000 });

    expect(result.classificationLevel).toBe("coarseGroup");
    expect(result.warnings).toEqual(["同業數在較細的分類下不足，已回退到更粗的分類層級。"]);
  });

  // Confirmed live: an unknown/not-yet-classified symbol is still a 200, found:false, everything else null/empty.
  it("returns found:false with null fields and empty arrays for an unknown symbol, without throwing", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        symbol: "NOPE9999",
        companyName: null,
        found: false,
        classificationLevel: null,
        industryCode: null,
        industryName: null,
        confidence: null,
        sampleSize: null,
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
      classificationLevel: null,
      industryCode: null,
      industryName: null,
      confidence: null,
      sampleSize: null,
      updatedAt: null,
      peers: [],
      warnings: [],
    });
  });

  it("relays analysis-ts's 400 message for an invalid query param", async () => {
    mockFetchOnce({ ok: false, status: 400, body: { message: '"minConfidence" must be a number' } });

    await expect(fetchPeerGroup("2330", { minConfidence: Number.NaN })).rejects.toMatchObject({
      statusCode: 400,
      message: '"minConfidence" must be a number',
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
