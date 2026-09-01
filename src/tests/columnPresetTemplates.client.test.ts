import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchColumnPresetTemplates } from "@/domains/columnPresetTemplates/columnPresetTemplates.client.js";

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

const SAMPLE_TEMPLATE = {
  key: "profitabilityQuality",
  name: "獲利品質拆解",
  description: "杜邦拆解 ROE...",
  fieldKeys: ["dupont.netProfitMarginQuarterly", "dupont.assetTurnoverQuarterly"],
};

describe("fetchColumnPresetTemplates", () => {
  // analysis-ts omits isDefault entirely on every template except the one true default (never sends
  // `false` explicitly) — normalize the missing case to false so callers can rely on a plain boolean.
  it("requests /filters on the configured filters service and defaults a missing isDefault to false", async () => {
    mockFetchOnce({ ok: true, body: { categories: [], columnPresets: [SAMPLE_TEMPLATE] } });

    const result = await fetchColumnPresetTemplates();

    expect(result).toEqual([{ ...SAMPLE_TEMPLATE, isDefault: false }]);
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/filters");
  });

  it("passes through isDefault: true for the one template that has it", async () => {
    mockFetchOnce({
      ok: true,
      body: { categories: [], columnPresets: [{ ...SAMPLE_TEMPLATE, key: "overview", isDefault: true }] },
    });

    const result = await fetchColumnPresetTemplates();

    expect(result[0]?.isDefault).toBe(true);
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchColumnPresetTemplates()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the filters service responds with a non-2xx status", async () => {
    mockFetchOnce({ ok: false, status: 503, body: {} });

    await expect(fetchColumnPresetTemplates()).rejects.toMatchObject({ statusCode: 502 });
  });

  it('throws a 502 AppError when the response body has no "columnPresets" array', async () => {
    mockFetchOnce({ ok: true, body: { categories: [] } });

    await expect(fetchColumnPresetTemplates()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when a columnPresets entry has a bare fieldKey format issue (non-string fieldKeys)", async () => {
    mockFetchOnce({
      ok: true,
      body: { categories: [], columnPresets: [{ ...SAMPLE_TEMPLATE, fieldKeys: [123] }] },
    });

    await expect(fetchColumnPresetTemplates()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when isDefault is present but not a boolean", async () => {
    mockFetchOnce({
      ok: true,
      body: { categories: [], columnPresets: [{ ...SAMPLE_TEMPLATE, isDefault: "yes" }] },
    });

    await expect(fetchColumnPresetTemplates()).rejects.toMatchObject({ statusCode: 502 });
  });
});
