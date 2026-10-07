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
  /** 對這個服務自己的（Prisma 管理的）資料庫發一次最小查詢。 */
  checkAppDatabase(): Promise<void>;

  /**
   * 確認 analysis-ts 有回應（2026-10-08 加，web-nuxt 的讀取失敗對話框輪詢它）。只是存活檢查：analysis-ts 沒有
   * 健康檢查端點，打的是它的 `GET /`，那支不碰資料庫，所以「ok」不保證它的資料庫醒著。
   *
   * 原本這裡還有 listPoolNames／checkPool，探的是 `<NAME>_DATABASE_URL` 連線池。2026-09-01 之後 bff-ts 不准
   * 直連任何別人的資料庫，那份登錄表永遠是空的、回應裡的 `neon` 永遠是 `{}`，同一天整段刪掉。
   */
  checkAnalysisService(): Promise<void>;
}
