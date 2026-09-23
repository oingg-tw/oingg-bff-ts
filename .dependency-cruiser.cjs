// Clean architecture 重構 Phase 0（2026-09-23）：先把「目標分層的依賴方向」變成可執行的規則，再開始搬
// 檔案。順序是刻意的——沒有這個檔案，重構到一半沒人擋得住回頭犯；有了它，每一階段都有客觀的通過標準。
//
// 這件事不是理論潔癖：`domainBusiness must never import domainBff` 這條規則 2026-09-06 就定下並修過兩處
// 違規，但今天重新量測又有 6 處。靠紀律維持的架構會腐化，靠 CI 維持的不會。
//
// 目標分層（依賴一律向內）：
//   src/domain          純規則，不依賴任何東西（zod 例外，enum/schema 用）
//   src/application     use case + port 介面；DB/HTTP 細節一律注入
//   src/infrastructure  port 的實作：prisma repository、analysis-ts HTTP client、firebase
//   src/http            ultimate-express 路由、middleware、OpenAPI
//   src/bootstrap       composition root，唯一知道所有層的地方
//
// 為什麼 bff-ts 的 domain 會比 analysis-ts 薄很多：這個服務刻意不擁有計算（見 memory 的
// feedback_proxy_apis_no_transformation / feedback_bff_minimize_data_ownership），代理端點沒有 entity
// 可言。薄不是缺陷，硬塞 entity 進去才是。真正住在 domain 的是這個服務自己擁有的規則：訂閱權限、
// 額度政策、preset 的互斥條件。
//
// 重構期間用 dependency-cruiser 內建的 baseline（.dependency-cruiser-known-violations.json +
// --ignore-known）讓既有違規逐階段歸零。2026-09-24 最後一個切片（proxy/stock）轉完後歸零，baseline 檔已
// 刪除、`npm run lint:deps` 也不再帶 --ignore-known——從此任何新違規直接是錯，沒有「先欠著」這個選項。
// 曲線：80 → 76 → 70 → 62 → 52 → 40 → 24 → 0。
const layer = (name) => `^src/${name}/`;

const WEB_FRAMEWORK = "node_modules/(ultimate-express|express|helmet|cors|express-rate-limit|swagger-ui-express|@asteasolutions)/";
// 除了 Prisma 套件本身，也把包著 PrismaClient 的模組算進去——否則 service 透過 adapters/neon 間接碰
// Prisma 會完全抓不到，規則就會假綠。
const PRISMA = "node_modules/@prisma/|^src/generated/prisma/|^src/(adapters/neon|infrastructure/prisma)/";
const FIREBASE = "node_modules/firebase-admin/";

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "循環依賴一律禁止。",
      from: {},
      to: { circular: true },
    },
    {
      name: "domain-imports-nothing",
      severity: "error",
      comment:
        "domain 是最內層：不得依賴其他分層，也不得依賴任何套件（zod 例外）。放得進 domain 的東西必須是" +
        "「換掉資料庫、換掉 HTTP 框架都不會變」的規則。",
      from: { path: layer("domain") },
      to: {
        path: "^src/(application|infrastructure|http|bootstrap|adapters|domainBff|domainBusiness|shared)/|node_modules/",
        pathNot: "node_modules/zod/",
      },
    },
    {
      name: "application-only-domain",
      severity: "error",
      comment:
        "application（use case + port 介面）只能依賴 domain。DB、HTTP client、Firebase 一律透過 port 注入" +
        "——「直接在 use case 裡呼叫 Prisma 比較短」是違規，不是務實。",
      from: { path: layer("application") },
      to: {
        path: `^src/(infrastructure|http|bootstrap|adapters)/|${PRISMA}|${WEB_FRAMEWORK}|${FIREBASE}`,
        pathNot: "node_modules/zod/",
      },
    },
    {
      name: "infrastructure-not-up",
      severity: "error",
      comment: "infrastructure 實作 application 的 port，不該反過來知道 http/bootstrap。",
      from: { path: layer("infrastructure") },
      to: { path: "^src/(http|bootstrap)/" },
    },
    {
      name: "http-not-infrastructure",
      severity: "error",
      comment:
        "http 只碰 application/domain，連型別也不行（DTO/port 型別住 application）。要哪個實作是 bootstrap 的事。",
      from: { path: layer("http") },
      to: { path: `^src/(infrastructure|bootstrap|adapters)/|${PRISMA}` },
    },
    {
      name: "business-not-import-bff",
      severity: "error",
      comment:
        "業務中台不得依賴 BFF 代理層（2026-09-06 的決定）。方向是單向的：BFF 可以用業務中台的東西，" +
        "反過來不行，否則『這個服務不擁有計算』的分界會被悄悄侵蝕。重構後這條由 application 內的" +
        "proxy/ 與各業務切片取代，但在搬完之前先守住現有目錄。",
      from: { path: "^src/domainBusiness/" },
      to: { path: "^src/domainBff/" },
    },
    {
      name: "not-to-unresolvable",
      severity: "error",
      comment:
        "import 指向不存在的模組。加這條是因為 2026-09-23 的分層搬移把 prisma/ 底下兩支 seed 腳本的 import " +
        "全部指到已經不存在的路徑，而它們既不在 tsconfig 的 include 裡、當時也不在 depcruise 的掃描範圍內—— " +
        "兩道防線同時沒蓋到，壞了好幾個 commit 都沒人發現。所以掃描範圍現在含 prisma/，規則也明講「解析不到就是錯」。",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "no-orphans",
      severity: "warn",
      comment: "沒有任何人 import 的檔案——搬移過程中忘了刪的舊檔會在這裡現形。",
      from: { orphan: true, pathNot: "\\.d\\.ts$|^src/index\\.ts$|\\.openapi\\.ts$" },
      to: {},
    },
  ],
  options: {
    // 本專案用 typescript@7（tsgo），dependency-cruiser 18 還不支援它的 API——不指定 parser 會解析到
    // 0 個模組然後回報「no violations found」，也就是假綠燈（2026-09-23 實測確認過）。改用 swc 解析，
    // 它的 AST 同樣保留 `import type`，型別依賴一樣算數。
    parser: "swc",
    doNotFollow: { path: "node_modules" },
    exclude: { path: "^src/generated/" },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["import", "require", "node", "default"] },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
