import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

process.env.FILTERS_SERVICE_URL = "http://localhost:5000";

import { fetchValuationRanking } from "@/domains/screener/valuationRanking.client.js";

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("fetchValuationRanking", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("calls oingg-analysis-ts's GET /valuation/ranking with metric/order/limit as query params", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { tradeDate: "2026-08-28", rankings: [{ symbol: "2330", value: 27.82 }] }),
    );

    const result = await fetchValuationRanking("peRatio", "asc", 10);

    expect(result).toEqual({ tradeDate: "2026-08-28", rankings: [{ symbol: "2330", value: 27.82 }] });
    const calledUrl = new URL(fetchMock.mock.calls[0]![0] as string | URL);
    expect(calledUrl.pathname).toBe("/valuation/ranking");
    expect(calledUrl.searchParams.get("metric")).toBe("peRatio");
    expect(calledUrl.searchParams.get("order")).toBe("asc");
    expect(calledUrl.searchParams.get("limit")).toBe("10");
  });

  // Regression test: fetch() itself throws for connection-level failures (refused/unreachable host,
  // not a rejected-but-received HTTP response) — found for real when oingg-analysis-ts's dev server
  // happened to be down mid-verification, and it surfaced as a generic uncaught 500 instead of a clear
  // "analysis service unreachable" 502.
  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    await expect(fetchValuationRanking("peRatio", "asc", 10)).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the analysis service responds with a non-2xx status", async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { message: "boom" }));

    await expect(fetchValuationRanking("pbRatio", "asc", 10)).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response body has no rankings array", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { oops: true }));

    await expect(fetchValuationRanking("dividendYield", "desc", 10)).rejects.toMatchObject({ statusCode: 502 });
  });

  it("returns an empty rankings array when the analysis service reports no data (not an error)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { tradeDate: null, rankings: [], warnings: ["no data for this date"] }),
    );

    await expect(fetchValuationRanking("dividendYield", "desc", 10)).resolves.toEqual({
      tradeDate: null,
      rankings: [],
    });
  });
});
