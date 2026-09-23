/**
 * 健康檢查真正去敲的那些依賴。實作住 infrastructure/prisma/systemHealth.ts。
 *
 * 這個 port 刻意只暴露「探針」，不暴露 PrismaClient 或 pg Pool 本身。重構前 system.service.ts 直接拿
 * getPrismaClient() 再自己寫 `$queryRaw\`SELECT 1\``——那等於 application 知道查詢語言、知道驅動、也知道
 * tagged template 這種 Prisma 專屬寫法。把整個 client 交出去的 port 也一樣糟：能拿到 client 就能拿到
 * 每一張表，port 就不再是一份副作用清單了。
 *
 * 分界線畫在「探測」與「判讀」之間：怎麼敲（SELECT 1、pg 還是 Prisma）是 infrastructure 的事；逾時多久
 * 算失敗、幾個失敗算 degraded、latency 怎麼量，是 system.service.ts 的政策，留在 application。所以這裡的
 * 方法成功就 resolve、失敗就 reject，不回傳任何狀態物件——狀態是上面那層的詞彙。
 */
export interface SystemHealthPort {
  /**
   * 目前註冊了哪些 Neon 連線池（`<NAME>_DATABASE_URL` 各一個）。
   *
   * 同步的，跟實作一樣——這只是讀一份啟動時就建好的登錄表，包成 Promise 只會讓呼叫端多一個 await，也會
   * 讓「這步沒有 I/O」這件事看不出來。空陣列是合法狀態（2026-09-01 之後 bff-ts 可能一個原始 pg 池都不需要）。
   */
  listPoolNames(): string[];

  /** 對指定的 Neon 連線池發一次最小查詢；成功就 resolve，連不上就 reject。 */
  checkPool(name: string): Promise<void>;

  /** 對這個服務自己的（Prisma 管理的）資料庫發一次最小查詢。 */
  checkAppDatabase(): Promise<void>;
}
