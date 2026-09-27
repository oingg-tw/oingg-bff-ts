# syntax=docker/dockerfile:1

# Node 24 對齊本機（v24.19.0）。用 -slim 而不是 -alpine：這個服務走 Prisma 的 driver adapter
# （@prisma/adapter-pg + pg），沒有原生 query engine 二進位檔，所以 alpine 的 musl 不是問題；
# 但 firebase-admin 的相依鏈在 glibc 上踩到的坑比較少，而 slim 跟 alpine 的大小差距不值得為此冒險。
FROM node:24-slim AS deps
WORKDIR /app
RUN corepack enable
# pnpm 版本由 package.json 的 packageManager 欄位決定（pnpm@11.22.0），corepack 會照著裝。
COPY package.json pnpm-lock.yaml ./
# prisma/ 必須在 install 之前就位：package.json 的 postinstall 會跑 prisma generate，
# 而它需要 schema.prisma。產出的 client 是純 TypeScript（output 在 src/generated/prisma），
# 所以它接著會被下面的 tsc 一起編譯進 dist。
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
# **順序有意義，不要把這個 COPY 移到 install 之前。** 上一階段的 postinstall 已經在
# /app/src/generated/prisma 產生了 client；Docker 的 COPY 是合併進既有目錄而不是覆蓋整個目錄，
# 所以那份產出會存活、其餘原始碼落在它旁邊。
# 同理 .dockerignore 排除 src/generated 也是刻意的：**不要把它放行**，否則本機那份（可能是舊的、
# 或跟這次 schema 不同步的）會蓋掉剛剛 generate 出來的那份，而症狀是執行期才出現的欄位缺失。
COPY src ./src
# build = rm dist && tsc -p tsconfig.build.json && tsc-alias（把 @/ 路徑別名改寫成相對路徑）。
RUN pnpm run build

# 只裝 production 相依，而且 --ignore-scripts 跳過 postinstall 的 prisma generate：
# 產生出來的 client 已經編譯進 dist 了，runtime 不需要 prisma CLI（它是 devDependency）。
FROM node:24-slim AS prod-deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# package.json 一定要在 runtime 出現：它的 "type": "module" 決定 Node 把 dist/*.js 當 ESM 讀。
# 少了它 Node 會用 CommonJS 解析而在第一個 import 就炸。
COPY package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# node:24-slim 內建的非 root 使用者，不自己建一個。
USER node
# Cloud Run 會注入 PORT（預設 8080），src/shared/env.ts 讀 process.env.PORT ?? 3000，所以不必寫死。
# 這裡不放 EXPOSE：Cloud Run 不看它，而寫一個跟實際注入值可能不同的數字只會誤導讀的人。
# 直接 node 而不是 pnpm start：少一層 process，SIGTERM 才會直接送到 Node
# （src/index.ts 有處理 SIGTERM 做 graceful shutdown，Cloud Run 縮容時靠它）。
CMD ["node", "dist/index.js"]
