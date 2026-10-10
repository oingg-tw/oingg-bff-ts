import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client.js";

/**
 * 2026-10-11 壓測（scripts/load-test.ts --mode races）抓到、只在並發時出現的兩個 500。這裡守修法本身；
 * 真正的並發行為由那支腳本對真的 DB 驗。
 */

const row = { id: "u1", firebaseUid: "uid-1", email: null, displayName: null, createdAt: new Date("2026-10-01T00:00:00Z") };
const upsert = vi.fn();
vi.mock("@/infrastructure/prisma/index.js", () => ({ getPrismaClient: () => ({ user: { upsert } }) }));

import { prismaUser } from "@/infrastructure/prisma/repositories/user.repository.js";
import { positionsInLockOrder } from "@/infrastructure/prisma/lockOrder.js";

describe("user upsert under concurrency", () => {
  it("新使用者的並發請求搶輸 upsert（P2002）時重試一次，不回 500", async () => {
    upsert.mockReset();
    upsert.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" }));
    upsert.mockResolvedValueOnce(row);

    await expect(prismaUser.ensureExists("uid-1")).resolves.toMatchObject({ firebaseUid: "uid-1" });
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it("其他錯誤照樣丟出，不吞掉", async () => {
    upsert.mockReset();
    upsert.mockRejectedValueOnce(new Error("connection lost"));

    await expect(prismaUser.ensureExists("uid-1")).rejects.toThrow("connection lost");
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});

describe("positionsInLockOrder", () => {
  it("依 id 排序（所有交易同一個鎖列順序），但每個 id 保留它在新順序裡的位置", () => {
    expect(positionsInLockOrder(["c", "a", "b"])).toEqual([
      [1, "a"],
      [2, "b"],
      [0, "c"],
    ]);
  });
});
