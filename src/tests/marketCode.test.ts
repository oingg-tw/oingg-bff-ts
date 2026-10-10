import { describe, expect, it } from "vitest";
import { readMarketFields, readPreferredMarketFields } from "@/infrastructure/analysisApi/market/marketCode.js";

/**
 * 上游的市場別分兩步換成 TYPEK，而且同一個 key（market）會在 2026-10-24 換編碼。讀法看值認編碼，所以上游在
 * 哪一個階段、部署的版本有沒有落後，讀出來的都要一樣。
 */
describe("readMarketFields：上游每個階段讀出來都一樣", () => {
  const phases = {
    步驟一前: { market: "TPEx", isEmerging: true },
    步驟一: { market: "TPEx", isEmerging: true, marketCode: "rotc" },
    "10/24 後": { market: "rotc", marketCode: "rotc" },
    "11/07 後": { market: "rotc" },
  };
  it.each(Object.entries(phases))("%s：興櫃是 rotc／TPEx／isEmerging true", (_phase, raw) => {
    expect(readMarketFields(raw)).toEqual({ marketCode: "rotc", market: "TPEx", isEmerging: true });
  });

  it("上市、上櫃", () => {
    expect(readMarketFields({ market: "sii" })).toEqual({ marketCode: "sii", market: "TWSE", isEmerging: false });
    expect(readMarketFields({ market: "TPEx", isEmerging: false })).toEqual({ marketCode: "otc", market: "TPEx", isEmerging: false });
  });

  // 排行列的舊編碼沒有 isEmerging：知道是 TPEx、分不出上櫃或興櫃——不能猜成 otc，也不能把 TPEx 丟掉。
  it("舊編碼的 TPEx 沒有 isEmerging 時：marketCode null，market 仍是 TPEx", () => {
    expect(readMarketFields({ market: "TPEx" })).toEqual({ marketCode: null, market: "TPEx", isEmerging: null });
  });

  it("未知的新值照樣放行，不改寫成 TWSE；缺欄位才落到 TWSE", () => {
    expect(readMarketFields({ marketCode: "pub" })).toEqual({ marketCode: "pub", market: "pub", isEmerging: null });
    expect(readMarketFields({})).toEqual({ marketCode: null, market: "TWSE", isEmerging: null });
  });
});

describe("readPreferredMarketFields", () => {
  it("新舊兩種都讀得出 marketCode 與中文 marketType", () => {
    expect(readPreferredMarketFields({ marketType: "上櫃" })).toEqual({ marketCode: "otc", marketType: "上櫃" });
    expect(readPreferredMarketFields({ marketType: "上櫃", marketCode: "otc" })).toEqual({ marketCode: "otc", marketType: "上櫃" });
    expect(readPreferredMarketFields({ marketCode: "otc" })).toEqual({ marketCode: "otc", marketType: "上櫃" });
    // 一步到位：marketType 與 marketCode 都拿掉，只剩 TYPEK 的 market
    expect(readPreferredMarketFields({ market: "otc" })).toEqual({ marketCode: "otc", marketType: "上櫃" });
    // 上游在三種之外給 null；舊欄位也不在時是 null，不是字串 "undefined"
    expect(readPreferredMarketFields({ marketCode: null })).toEqual({ marketCode: null, marketType: null });
  });
});
