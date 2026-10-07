import { getPrismaClient } from "@/infrastructure/prisma/index.js";
import type { SystemHealthPort } from "@/application/ports/systemHealth.js";

/**
 * SystemHealthPort 的實作：真的對每個依賴發一次最小查詢，而不是回報「行程還活著」或「啟動時註冊過這個
 * 池」——註冊過不代表現在連得上，那正是這支健康檢查要回答的事。
 *
 * 兩個探針走的是兩條不同的路徑，這是刻意的：Neon 池是原始 pg 連線（`<NAME>_DATABASE_URL`），app DB 是
 * Prisma 管的這個服務自己的 DB（`DATABASE_URL`），各自的連線池與失敗模式並不共用，任何一邊壞掉都要能被
 * 單獨指認出來。
 *
 * 回傳 Promise<void>：查到什麼不重要，「有沒有回話」才是被問的問題。逾時、latency、degraded 的判定全在
 * application/system/system.service.ts——這裡只負責敲門。
 */
export const prismaSystemHealth: Pick<SystemHealthPort, "checkAppDatabase"> = {
  async checkAppDatabase() {
    await getPrismaClient().$queryRaw`SELECT 1`;
  },
};
