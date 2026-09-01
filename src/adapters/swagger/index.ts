import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import swaggerJSDoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import { env } from "@/shared/env.js";

// ESM has no __dirname; rebuild it from import.meta.url.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// glob (used internally by swagger-jsdoc) treats "\" as an escape character, so Windows-style
// paths from join() silently match zero files there. Normalize to "/".
const toGlobPath = (...segments: string[]) => join(...segments).split("\\").join("/");

// Unlike sibling services (which only ever run via tsx against src/), this one also runs compiled
// output directly with `node dist/index.js`. tsc preserves comments, so the @swagger JSDoc blocks
// survive into the .js files too — just match whichever extension this very module is running as.
const sourceExtension = __filename.endsWith(".ts") ? "ts" : "js";

const options: swaggerJSDoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "oingg-bff-ts API",
      version: "1.0.0",
      description: "BFF API documentation for the oingg-bff-ts service",
    },
    servers: [
      {
        url: `http://localhost:${env.port}`,
        description: "Development server",
      },
    ],
    tags: [
      { name: "System", description: "伺服器狀態" },
      { name: "Auth", description: "Firebase 登入驗證" },
      { name: "User", description: "使用者資料" },
      { name: "Stock", description: "股票資料查詢——股價、本益比、本淨比、殖利率" },
      { name: "Watchlist", description: "使用者自選股清單 CRUD" },
      { name: "Holdings", description: "使用者持股管理 CRUD（獨立維護，不從交易日誌自動計算）" },
      { name: "Transactions", description: "交易日誌（買進／賣出交易紀錄）CRUD" },
      { name: "Screener", description: "依 filterCatalog 指標篩選個股，並依使用者設定的欄位偏好回傳結果" },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "Firebase ID token（requireAuth middleware 驗證用）",
        },
      },
    },
  },
  apis: [
    toGlobPath(__dirname, `../../domains/**/*.${sourceExtension}`),
    toGlobPath(__dirname, `../../routes.${sourceExtension}`),
  ],
};

export const swaggerSpec = swaggerJSDoc(options);
export { swaggerUi };
