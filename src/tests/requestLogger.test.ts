import { describe, expect, it } from "vitest";
import { maskIpChain } from "@/http/requestLogger.js";

describe("maskIpChain", () => {
  it("IPv4 抹掉末段、IPv6 只留前 64 位元，鏈的順序與項數不變（限流鍵靠它驗證）", () => {
    expect(maskIpChain("203.0.113.57, 35.191.2.10")).toBe("203.0.113.0, 35.191.2.0");
    expect(maskIpChain("2001:db8:85a3:8d3:1319:8a2e:370:7348")).toBe("2001:db8:85a3:8d3::");
    expect(maskIpChain("2001:db8::1")).toBe("2001:db8:0:0::");
    expect(maskIpChain("::ffff:198.51.100.23")).toBe("::ffff:198.51.100.0");
    expect(maskIpChain("not-an-ip")).toBe("?");
  });
});
