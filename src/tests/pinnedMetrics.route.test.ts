import { describe, expect, it } from "vitest";
import { parseBody } from "@/shared/validation.js";
import { updatePinnedMetricsSchema } from "@/http/modules/user/route.js";

/** 跟 web-nuxt 約定的合約（2026-10-08）：順序照存、不去重，最多 50 筆，每筆 1～64 字元。 */
describe("updatePinnedMetricsSchema", () => {
  it("順序與重複都原樣保留（順序就是側邊欄順序）", () => {
    expect(parseBody(updatePinnedMetricsSchema, { slugs: ["roe", "eps", "roe"] }).slugs).toEqual(["roe", "eps", "roe"]);
    expect(parseBody(updatePinnedMetricsSchema, { slugs: [] }).slugs).toEqual([]);
  });

  it("50 筆可以、51 筆不行；空字串與超過 64 字元的項目不行", () => {
    expect(() => parseBody(updatePinnedMetricsSchema, { slugs: Array.from({ length: 50 }, (_, i) => `m${i}`) })).not.toThrow();
    for (const slugs of [Array.from({ length: 51 }, (_, i) => `m${i}`), [""], ["x".repeat(65)]]) {
      expect(() => parseBody(updatePinnedMetricsSchema, { slugs })).toThrow(expect.objectContaining({ statusCode: 400 }));
    }
  });
});
