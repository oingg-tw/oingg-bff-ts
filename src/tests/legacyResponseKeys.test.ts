import { describe, expect, it } from "vitest";
import { withLegacyResponseKeys } from "@/http/legacyResponseKeys.js";

/** 回應欄位改名並存期（2026-10-10）：送出前把舊名補回去，給 web-nuxt 過渡。 */
describe("withLegacyResponseKeys", () => {
  it("遞迴補上舊名、值相同；已經有舊名的不覆寫；其他欄位不動", () => {
    const body = {
      entries: [{ yearMonth: "2026-08", yoyChangePct: 33.8, numberOfSharesIssued: "100" }],
      badge: { threshold: { percentileRank: { scope: "market", topPct: 20 } } },
      already: { changePct: 1, changePercent: 9 },
      other: null,
    };

    expect(withLegacyResponseKeys(body)).toEqual({
      entries: [{ yearMonth: "2026-08", yoyChangePct: 33.8, yoyChangePercent: 33.8, numberOfSharesIssued: "100", paidInShares: "100" }],
      badge: { threshold: { percentileRank: { scope: "market", topPct: 20, topPercent: 20 } } },
      already: { changePct: 1, changePercent: 9 },
      other: null,
    });
  });
});
