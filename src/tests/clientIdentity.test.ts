import { afterEach, describe, expect, it } from "vitest";
import { clientIpOf, isFromNitro } from "@/http/clientIdentity.js";

const ORIGINAL = process.env.NITRO_SHARED_SECRET;

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.NITRO_SHARED_SECRET;
  } else {
    process.env.NITRO_SHARED_SECRET = ORIGINAL;
  }
});

function req(headers: Record<string, string>) {
  return { ip: "10.0.0.1", headers };
}

describe("clientIpOf", () => {
  it("只信任帶對密鑰的 Nitro 轉來的 X-Oingg-Client-Ip", () => {
    process.env.NITRO_SHARED_SECRET = "s3cret";
    const fromNitro = req({ "x-oingg-nitro-key": "s3cret", "x-oingg-client-ip": "203.0.113.57", "x-forwarded-for": "34.1.2.3" });

    expect(isFromNitro(fromNitro)).toBe(true);
    expect(clientIpOf(fromNitro)).toBe("203.0.113.57");
  });

  it("密鑰錯、或伺服器沒設密鑰時，偽造的 X-Oingg-Client-Ip 一律被忽略，退回 XFF 最右邊", () => {
    process.env.NITRO_SHARED_SECRET = "s3cret";
    const spoofed = req({ "x-oingg-nitro-key": "guess", "x-oingg-client-ip": "198.51.100.9", "x-forwarded-for": "1.1.1.1, 34.1.2.3" });
    expect(clientIpOf(spoofed)).toBe("34.1.2.3");

    delete process.env.NITRO_SHARED_SECRET;
    const noSecret = req({ "x-oingg-nitro-key": "", "x-oingg-client-ip": "198.51.100.9" });
    expect(isFromNitro(noSecret)).toBe(false);
    expect(clientIpOf(noSecret)).toBe("10.0.0.1");
  });
});
