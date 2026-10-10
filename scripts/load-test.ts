/**
 * 業務中台的效能與可靠性測試（2026-10-11，使用者：「效能與可靠性，避免有些程式錯誤到了正式環境才發現」）。
 *
 *   npm run load:test -- --target local --mode smoke
 *   npm run load:test -- --target dev --mode load --rate 3 --minutes 10
 *
 * 模式：
 *   smoke  每條 journey 打一次：全部 2xx、錯誤一律 problem+json 帶 code、每個回應都有 X-Request-Id
 *   load   固定到達率（open-loop：照時間表發、不等上一個回來，否則慢的時候發得也少，延遲會被藏掉）
 *   ramp   到達率階梯式往上加，找單台的拐點（p95 爆增、非預期錯誤、503 server_busy）
 *   soak   中等負載跑久一點，看 RSS 與延遲有沒有一路往上爬
 *   spike  一次灌一大批（DEV 閒置到 0 instance 之後跑），看冷啟動是乾淨的 504 還是卡住／500
 *   races  並發下的程式錯誤：配額先算再寫、自選股重複新增、reorder 互搶、帳本並發寫入、重複匯入
 *
 * 上游是真的 analysis-ts（使用者 2026-10-11：「就是要真實」），所以跑之前先通知 analysis-ts 時段。
 *
 * 限流：匿名 VU 帶 X-Oingg-Nitro-Key ＋各自的 X-Oingg-Client-Ip——就是正式環境 Nitro 轉送很多使用者的那條
 * 路，每個 VU 一個 300/分 的桶；沒有 NITRO_SHARED_SECRET 時全部擠進同一個桶，腳本會警告並把到達率壓低。
 * 全站上限（GLOBAL_RATE_LIMIT_PER_INSTANCE）是伺服器端的 env：ramp 要找真正的拐點時把它暫時調高。
 *
 * 跟 security-check 一樣：臨時帳號跑完一定刪除，密碼與 token 不印出來。
 */
import "dotenv/config";
import { execFile, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { parseArgs } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { createEphemeralUser, deleteEphemeralUser, type EphemeralUser } from "./testUsers.js";

const { values: args } = parseArgs({
  options: {
    target: { type: "string", default: "local" },
    mode: { type: "string", default: "smoke" },
    rate: { type: "string" }, // journeys per second
    minutes: { type: "string" },
    "step-seconds": { type: "string", default: "120" },
    users: { type: "string", default: "20" },
    out: { type: "string" },
  },
});

const TARGET = args.target as "local" | "dev";
const MODE = args.mode as "smoke" | "load" | "ramp" | "soak" | "spike" | "races";

// 流量組成：每條 journey 是 web-nuxt 一頁實際會同時打的那組請求。比例照「看個股頁最多」估的，調這裡就好。
const JOURNEY_WEIGHTS = { stockPage: 50, screener: 20, market: 15, portfolio: 10, preferences: 5 } as const;
type JourneyName = keyof typeof JOURNEY_WEIGHTS;

const ANON_VUS = 200;
const REQUEST_TIMEOUT_MS = 30_000; // 比伺服器等上游的 10 秒長得多：要看到的是伺服器自己回的 504，不是我們先放棄
const ABORT_UNEXPECTED_RATE = 0.05; // 非預期錯誤超過 5% 就中止：大量被擋時，結果表面上會看起來像「沒資料」

// ---------------------------------------------------------------------------
// Target
// ---------------------------------------------------------------------------

function sh(command: string): string {
  return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

const BASE_URL =
  process.env.BASE_URL ??
  (TARGET === "dev"
    ? sh("gcloud run services describe oingg-bff-ts --region=asia-southeast1 --project=oingg-bff --format=value(status.url)")
    : "http://localhost:4100");

let iamToken = TARGET === "dev" ? sh("gcloud auth print-identity-token") : "";
const nitroKey =
  process.env.NITRO_SHARED_SECRET ??
  (TARGET === "dev"
    ? (() => {
        try {
          return sh("gcloud secrets versions access latest --secret=NITRO_SHARED_SECRET --project=oingg-bff");
        } catch {
          return undefined;
        }
      })()
    : undefined);

// ---------------------------------------------------------------------------
// Requests and samples
// ---------------------------------------------------------------------------

type Kind = "ok" | "upstream" | "busy" | "limited" | "unexpected";

interface Sample {
  journey: string;
  name: string;
  at: number; // ms since run start
  ms: number;
  status: number;
  code: string | null;
  kind: Kind;
  detail?: string;
}

interface Call {
  name: string;
  path: string;
  method?: string;
  body?: unknown;
  token?: string;
  /** 預設 [200]；races 會放 201／409／403 這類「這情況本來就該回」的狀態。 */
  expect?: number[];
  /** 這支的回應在一次執行內應該固定：負載下回應內容不同就是快取或共用狀態出錯。 */
  stable?: boolean;
}

interface Result {
  status: number;
  json: unknown;
  ms: number;
}

const samples: Sample[] = [];
const stableHashes = new Map<string, string>();
const stableMismatches: string[] = [];
let runStart = performance.now();

function headersFor(vu: number, token?: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (iamToken) headers["X-Serverless-Authorization"] = `Bearer ${iamToken}`;
  if (nitroKey) {
    headers["X-Oingg-Nitro-Key"] = nitroKey;
    headers["X-Oingg-Client-Ip"] = `10.77.${(vu >> 8) & 255}.${vu & 255}`;
  }
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function call(journey: string, vu: number, c: Call): Promise<Result> {
  const started = performance.now();
  let status = 0;
  let text = "";
  let headers: Headers | null = null;
  try {
    const response = await fetch(BASE_URL + c.path, {
      method: c.method ?? "GET",
      headers: headersFor(vu, c.token),
      body: c.body !== undefined ? JSON.stringify(c.body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    status = response.status;
    headers = response.headers;
    text = await response.text();
  } catch (error) {
    text = String(error);
  }
  const ms = performance.now() - started;
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  const code = typeof (json as { code?: unknown })?.code === "string" ? (json as { code: string }).code : null;
  const { kind, detail } = classify(c, status, code, json, text, headers);
  samples.push({ journey, name: c.name, at: started - runStart, ms, status, code, kind, detail });

  if (c.stable && status === 200 && kind === "ok") {
    const hash = createHash("sha1").update(text).digest("hex");
    const key = `${c.method ?? "GET"} ${c.path}`;
    const seen = stableHashes.get(key);
    if (seen === undefined) stableHashes.set(key, hash);
    else if (seen !== hash) stableMismatches.push(key);
  }
  return { status, json, ms };
}

function classify(c: Call, status: number, code: string | null, json: unknown, text: string, headers: Headers | null): { kind: Kind; detail?: string } {
  if (status === 0) return { kind: "unexpected", detail: `no response: ${text.slice(0, 120)}` };
  // 契約：每個回應都帶 X-Request-Id；錯誤一律是 problem+json（code 是選填的擴充欄位，沒有就是 type about:blank）；
  // 成功回應是 JSON（204 除外）。5xx 不管有沒有在 expect 裡都算非預期，只有上游造成、帶 upstream_ code 的除外。
  if (!headers?.get("x-request-id")) return { kind: "unexpected", detail: "missing X-Request-Id" };
  if (status >= 400) {
    if (!headers.get("content-type")?.includes("application/problem+json")) return { kind: "unexpected", detail: `${status} not problem+json: ${text.slice(0, 120)}` };
  } else if (status !== 204 && json === undefined) {
    return { kind: "unexpected", detail: `${status} body is not JSON` };
  }
  if ((c.expect ?? [200]).includes(status)) return { kind: "ok" };
  if ((status === 502 || status === 504) && code?.startsWith("upstream_")) return { kind: "upstream", detail: code };
  if (status === 503 && code === "server_busy") {
    return headers.get("retry-after") ? { kind: "busy" } : { kind: "unexpected", detail: "503 server_busy without Retry-After" };
  }
  if (status === 429) return { kind: "limited", detail: code ?? undefined };
  return { kind: "unexpected", detail: `${status} ${code ?? ""} ${text.slice(0, 160)}` };
}

// ---------------------------------------------------------------------------
// Journeys
// ---------------------------------------------------------------------------

let symbols: string[] = [];
const authUsers: EphemeralUser[] = [];

const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)] as T;

function journeyCalls(name: JourneyName, user: EphemeralUser | undefined): Call[] {
  const s = pick(symbols);
  switch (name) {
    case "stockPage":
      return [
        { name: "quote", path: `/stocks/${s}`, expect: [200, 404] },
        { name: "profile", path: `/stocks/${s}/profile`, stable: true },
        { name: "metrics-history", path: `/stocks/${s}/metrics-history?metricCodes=roe,grossMargin,operatingMargin&timeframe=Q&limit=12` },
        { name: "monthly-revenue", path: `/stocks/${s}/monthly-revenue-history?limit=24`, stable: true },
        { name: "dividend-history", path: `/stocks/${s}/dividend-history`, stable: true },
        { name: "roe-history", path: `/stocks/${s}/roe-history?timeframe=TTM&limit=12` },
        { name: "financial-statement", path: `/stocks/${s}/financial-statement?statementType=incomeStatement`, stable: true },
        { name: "provenance", path: `/stocks/${s}/metric-provenance?metricCode=roe` },
        { name: "badges", path: `/stocks/${s}/badges` },
      ];
    case "screener":
      return [
        { name: "metrics", path: "/metrics" },
        {
          name: "screener",
          path: "/screener",
          method: "POST",
          body: { filters: [{ field: "roe.TTM", min: 15, max: null, exclude: false }], columns: ["roe.TTM", "grossMargin.TTM"], sortField: "roe.TTM", order: "desc", pageSize: 50 },
        },
        {
          name: "screener-values",
          path: "/screener/values",
          method: "POST",
          body: { symbols: Array.from({ length: 20 }, () => pick(symbols)), columns: [{ field: "roe.TTM" }, { field: "peRatio.TTM" }] },
        },
        { name: "ranking", path: "/screener/ranking?field=dividendYield.EOD&order=desc&limit=20" },
        { name: "company-rank", path: `/screener/company-rank?symbol=${s}&field=roe.TTM&order=desc` },
      ];
    case "market":
      return [
        { name: "revenue-ranking", path: "/market/revenue-ranking?metric=yoy&order=desc&limit=20" },
        { name: "volume-top20", path: "/market/volume-top20" },
        { name: "price-change", path: "/market/price-change-ranking?limit=20" },
        { name: "attention", path: "/market/attention-stocks?limit=20" },
        { name: "disposed", path: "/market/disposed-stocks?limit=20" },
        { name: "etf-ranking", path: "/market/etf-ranking?metric=aum&order=desc&limit=20" },
        { name: "sectors", path: "/industries/securities-sectors", stable: true },
        { name: "sector-summary", path: "/industries/sector-summary?fields=roe.TTM,grossMargin.TTM" },
        { name: "cpi", path: "/macro/cpi" },
      ];
    case "portfolio":
      return [
        { name: "holdings", path: "/holdings", token: user?.idToken },
        { name: "performance", path: "/holdings/performance", token: user?.idToken },
        { name: "risk", path: "/holdings/risk", token: user?.idToken },
        { name: "watchlist", path: "/watchlist", token: user?.idToken },
        { name: "transactions", path: "/transactions", token: user?.idToken },
      ];
    case "preferences":
      return [
        { name: "pinned-get", path: "/users/me/pinned-metrics", token: user?.idToken },
        { name: "pinned-put", path: "/users/me/pinned-metrics", method: "PUT", body: { slugs: ["roe", "grossMargin", "peRatio"] }, token: user?.idToken },
        { name: "holding-columns", path: "/users/me/holding-columns", token: user?.idToken },
        { name: "me", path: "/users/me", token: user?.idToken },
      ];
  }
}

const weighted: JourneyName[] = (Object.entries(JOURNEY_WEIGHTS) as [JourneyName, number][]).flatMap(([name, w]) => Array<JourneyName>(w).fill(name));

let vuCounter = 0;
async function runJourney(name: JourneyName): Promise<void> {
  const needsUser = name === "portfolio" || name === "preferences";
  const vu = vuCounter++ % ANON_VUS;
  const user = needsUser ? authUsers[vu % authUsers.length] : undefined;
  if (needsUser && !user) return;
  const userVu = user ? 10_000 + authUsers.indexOf(user) : vu; // 登入的 VU 以 uid 分桶，IP 也固定給它一個
  await Promise.all(journeyCalls(name, user).map((c) => call(name, userVu, c)));
}

// ---------------------------------------------------------------------------
// Open-loop driver
// ---------------------------------------------------------------------------

const inFlight = new Set<Promise<void>>();

async function drive(ratePerSecond: number, seconds: number, label: string): Promise<{ from: number; to: number }> {
  const from = performance.now() - runStart;
  const interval = 1000 / ratePerSecond;
  const end = performance.now() + seconds * 1000;
  let next = performance.now();
  while (performance.now() < end) {
    const p = runJourney(pick(weighted)).finally(() => inFlight.delete(p));
    inFlight.add(p);
    next += interval;
    const wait = next - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (inFlight.size > 2000) throw new Error(`${label}: 2000 journeys in flight — the server isn't keeping up, stopping`);
    abortIfFailing(label);
  }
  await Promise.all(inFlight);
  return { from, to: performance.now() - runStart };
}

function abortIfFailing(label: string): void {
  if (samples.length < 200 || samples.length % 50 !== 0) return;
  const recent = samples.slice(-200);
  const bad = recent.filter((s) => s.kind === "unexpected").length;
  if (bad / recent.length > ABORT_UNEXPECTED_RATE) {
    const why = recent.filter((s) => s.kind === "unexpected").slice(0, 3).map((s) => `${s.name}: ${s.detail}`).join(" | ");
    throw new Error(`${label}: ${bad}/200 recent requests failed unexpectedly — aborting. ${why}`);
  }
}

// ---------------------------------------------------------------------------
// Server-side observation (local: RSS of the listening process)
// ---------------------------------------------------------------------------

const rss: { at: number; mb: number }[] = [];
let rssTimer: NodeJS.Timeout | undefined;

function startRssSampler(): void {
  if (TARGET !== "local") return;
  const port = new URL(BASE_URL).port || "80";
  const run = promisify(execFile);
  const script = `(Get-Process -Id (Get-NetTCPConnection -LocalPort ${port} -State Listen | Select-Object -First 1).OwningProcess).WorkingSet64`;
  rssTimer = setInterval(() => {
    run("powershell", ["-NoProfile", "-Command", script])
      .then(({ stdout }) => rss.push({ at: performance.now() - runStart, mb: Math.round(Number(stdout.trim()) / 1048576) }))
      .catch(() => undefined);
  }, 5000);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] as number;
}

function summarize(list: Sample[]) {
  const ms = list.map((s) => s.ms).sort((a, b) => a - b);
  const count = (k: Kind) => list.filter((s) => s.kind === k).length;
  return {
    n: list.length,
    p50: Math.round(pct(ms, 50)),
    p95: Math.round(pct(ms, 95)),
    p99: Math.round(pct(ms, 99)),
    max: Math.round(ms.at(-1) ?? 0),
    upstream: count("upstream"),
    busy: count("busy"),
    limited: count("limited"),
    unexpected: count("unexpected"),
  };
}

function report(windows: { label: string; from: number; to: number }[], extra: Record<string, unknown> = {}): boolean {
  const byName = new Map<string, Sample[]>();
  for (const s of samples) byName.set(`${s.journey}/${s.name}`, [...(byName.get(`${s.journey}/${s.name}`) ?? []), s]);
  console.log(`\n=== ${MODE} @ ${TARGET} (${BASE_URL}) ===`);
  console.table(Object.fromEntries([...byName].sort().map(([k, v]) => [k, summarize(v)])));
  if (windows.length > 0) {
    console.log("By window:");
    console.table(
      Object.fromEntries(
        windows.map((w) => {
          const inWindow = samples.filter((s) => s.at >= w.from && s.at < w.to);
          return [w.label, { ...summarize(inWindow), rps: Math.round((inWindow.length / ((w.to - w.from) / 1000)) * 10) / 10 }];
        }),
      ),
    );
  }
  const unexpected = samples.filter((s) => s.kind === "unexpected");
  const groups = new Map<string, number>();
  for (const s of unexpected) groups.set(`${s.journey}/${s.name}: ${s.detail}`, (groups.get(`${s.journey}/${s.name}: ${s.detail}`) ?? 0) + 1);
  const upstream = new Map<string, number>();
  for (const s of samples.filter((x) => x.kind === "upstream")) upstream.set(`${s.name} ${s.status} ${s.code}`, (upstream.get(`${s.name} ${s.status} ${s.code}`) ?? 0) + 1);

  console.log("\nInvariants:");
  const checks: [string, boolean, string][] = [
    ["no unexpected responses (5xx, contract violations, wrong status)", unexpected.length === 0, `${unexpected.length}`],
    ["stable responses unchanged under load", stableMismatches.length === 0, [...new Set(stableMismatches)].slice(0, 5).join(", ")],
  ];
  for (const [name, ok, detail] of checks) console.log(`  ${ok ? "✓ PASS" : "✗ FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
  if (groups.size) console.log("\nUnexpected (top 15):", [...groups].sort((a, b) => b[1] - a[1]).slice(0, 15));
  if (upstream.size) console.log("\nUpstream errors (counted separately, not ours):", [...upstream]);
  if (rss.length) console.log("\nRSS MB (local, every 5s):", rss.map((r) => r.mb).join(" "));

  const out = args.out ?? `load-test-${MODE}-${TARGET}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(out, JSON.stringify({ mode: MODE, target: TARGET, baseUrl: BASE_URL, windows, rss, stableMismatches, extra, samples }, null, 1));
  console.log(`\nFull samples: ${out}`);
  return checks.every(([, ok]) => ok);
}

// ---------------------------------------------------------------------------
// Races — concurrency bugs that only show up with simultaneous requests
// ---------------------------------------------------------------------------

interface RaceResult {
  name: string;
  ok: boolean;
  detail: string;
}

async function races(prisma: PrismaClient, free: EphemeralUser, other: EphemeralUser): Promise<RaceResult[]> {
  const out: RaceResult[] = [];
  const statuses = (rs: Result[]) => rs.map((r) => r.status).sort().join(",");
  const no5xx = (rs: Result[]) => rs.every((r) => r.status < 500);

  // 新帳號在 14 天反向試用期內是 PRO，配額不擋；把 createdAt 推到 30 天前讓它變成 FREE。
  await call("races", 9001, { name: "me", path: "/users/me", token: free.idToken });
  await prisma.user.update({ where: { firebaseUid: free.uid }, data: { createdAt: new Date(Date.now() - 30 * 86_400_000) } });
  const ent = await call("races", 9001, { name: "entitlement", path: "/billing/entitlement", token: free.idToken });
  const tier = JSON.stringify(ent.json).match(/"tier":"(\w+)"/)?.[1];
  out.push({ name: "setup: account is FREE", ok: tier === "FREE", detail: `tier=${tier}` });

  // 1. 配額：enforceQuota 先 count 再交給後面 insert，中間沒有鎖。
  const quota = async (label: string, cap: number, n: number, mk: (i: number) => Call, listPath: string, listKey: string) => {
    const rs = await Promise.all(Array.from({ length: n }, (_, i) => call("races", 9001, { ...mk(i), token: free.idToken, expect: [201, 403, 409] })));
    const created = rs.filter((r) => r.status === 201).length;
    const list = await call("races", 9001, { name: `${label}-list`, path: listPath, token: free.idToken });
    const stored = ((list.json as Record<string, unknown[]>)?.[listKey] ?? []).length;
    // 對照組：並發之後再循序送一筆，必須是 403——證明配額本身有作用，超過上限只是並發造成的。
    const sequential = await call("races", 9001, { ...mk(n), token: free.idToken, expect: [403] });
    out.push({ name: `quota race: ${label} (cap ${cap}, ${n} concurrent)`, ok: created <= cap && stored <= cap && no5xx(rs), detail: `201s=${created} stored=${stored} then sequential=${sequential.status} statuses=${statuses(rs)}` });
  };
  await quota("screener presets", 3, 10, (i) => ({ name: "preset-create", path: "/screener/presets", method: "POST", body: { name: `race-${i}-${Date.now()}`, filters: [{ field: "peRatio.TTM", min: 1, max: 20, exclude: false }] } }), "/screener/presets", "presets");
  await quota("column presets", 3, 10, (i) => ({ name: "column-preset-create", path: "/screener/column-presets", method: "POST", body: { name: `race-${i}-${Date.now()}`, columns: [{ field: "peRatio.TTM" }] } }), "/screener/column-presets", "columnPresets");
  const watchSymbols = symbols.slice(0, 16); // 第 16 檔給並發之後的循序對照組
  await quota("watchlist", 10, 15, (i) => ({ name: "watchlist-add", path: "/watchlist", method: "POST", body: { symbol: watchSymbols[i] } }), "/watchlist", "items");

  // 2. 同一檔股票同時加進自選股：剛好一個 201，其餘 409，DB 只有一列。
  const dup = await Promise.all(Array.from({ length: 10 }, () => call("races", 9002, { name: "watchlist-dup", path: "/watchlist", method: "POST", body: { symbol: "2330" }, token: other.idToken, expect: [201, 409] })));
  const dupRows = await prisma.watchlistItem.count({ where: { firebaseUid: other.uid, symbol: "2330" } });
  out.push({ name: "duplicate watchlist add", ok: dup.filter((r) => r.status === 201).length === 1 && dupRows === 1 && no5xx(dup), detail: `statuses=${statuses(dup)} rows=${dupRows}` });

  // 3. reorder 互搶：最後的順序必須是某一個請求的完整順序。
  for (const sym of ["2317", "2454", "2412", "2882"]) await call("races", 9002, { name: "watchlist-add", path: "/watchlist", method: "POST", body: { symbol: sym }, token: other.idToken, expect: [201] });
  const items = ((await call("races", 9002, { name: "watchlist", path: "/watchlist", token: other.idToken })).json as { items: { id: string }[] }).items.map((x) => x.id);
  const perms = Array.from({ length: 10 }, () => [...items].sort(() => Math.random() - 0.5));
  const ro = await Promise.all(perms.map((ids) => call("races", 9002, { name: "watchlist-reorder", path: "/watchlist/reorder", method: "POST", body: { ids }, token: other.idToken })));
  const final = ((await call("races", 9002, { name: "watchlist", path: "/watchlist", token: other.idToken })).json as { items: { id: string }[] }).items.map((x) => x.id).join();
  out.push({ name: "concurrent watchlist reorder", ok: perms.some((p) => p.join() === final) && no5xx(ro), detail: `statuses=${statuses(ro)} final matches a request=${perms.some((p) => p.join() === final)}` });

  // 4. 帳本並發寫入，同時讀持股：最後持股＝被接受的買－被接受的賣，不得為負，不得 5xx。
  const buys = Array.from({ length: 10 }, (_, i) => ({ name: "tx-buy", path: "/transactions", method: "POST", body: { symbol: "2317", action: "BUY", quantity: 1000, price: 100, tradeDate: `2026-08-${String(i + 1).padStart(2, "0")}` }, token: other.idToken, expect: [201] }));
  const sells = Array.from({ length: 5 }, (_, i) => ({ name: "tx-sell", path: "/transactions", method: "POST", body: { symbol: "2317", action: "SELL", quantity: 1000, price: 110, tradeDate: `2026-08-${String(i + 20).padStart(2, "0")}` }, token: other.idToken, expect: [201, 400] }));
  const reads = Array.from({ length: 10 }, () => ({ name: "holdings-during-writes", path: "/holdings", token: other.idToken }));
  const ledger = await Promise.all([...buys, ...sells, ...reads].sort(() => Math.random() - 0.5).map((c) => call("races", 9002, c as Call)));
  const rows = await prisma.stockTransaction.findMany({ where: { firebaseUid: other.uid, symbol: "2317" }, select: { action: true, quantity: true } });
  const expectedQty = rows.reduce((sum, r) => sum + (r.action === "BUY" ? Number(r.quantity) : -Number(r.quantity)), 0);
  const holdings = (await call("races", 9002, { name: "holdings", path: "/holdings", token: other.idToken })).json as { holdings: { symbol: string; quantity: number }[] };
  const held = holdings.holdings.find((h) => h.symbol === "2317")?.quantity ?? 0;
  out.push({ name: "concurrent ledger writes", ok: held === expectedQty && expectedQty >= 0 && no5xx(ledger), detail: `held=${held} ledger=${expectedQty} rows=${rows.length} statuses=${statuses(ledger)}` });

  // 4b. 超賣檢查也是先重放帳本再寫入：只有 1,000 股時同時送 5 筆各賣 1,000，最多只能成功 1 筆。
  await call("races", 9002, { name: "tx-buy", path: "/transactions", method: "POST", body: { symbol: "2603", action: "BUY", quantity: 1000, price: 50, tradeDate: "2026-08-01" }, token: other.idToken, expect: [201] });
  const oversell = await Promise.all(Array.from({ length: 5 }, () => call("races", 9002, { name: "tx-oversell", path: "/transactions", method: "POST", body: { symbol: "2603", action: "SELL", quantity: 1000, price: 60, tradeDate: "2026-09-01" }, token: other.idToken, expect: [201, 400] })));
  const sold = await prisma.stockTransaction.count({ where: { firebaseUid: other.uid, symbol: "2603", action: "SELL" } });
  out.push({ name: "concurrent oversell", ok: sold <= 1 && no5xx(oversell), detail: `SELL rows=${sold} (max 1) statuses=${statuses(oversell)}` });

  // 5. 同一份匯入同時送 5 次（externalRef 去重也是先查再寫），再同時刪 3 次。
  const importBody = {
    source: "yuanta-csv",
    transactions: Array.from({ length: 20 }, (_, i) => ({ externalRef: `race-${i}`, tradeDate: `2026-07-${String(i + 1).padStart(2, "0")}`, symbol: "2412", action: "BUY", quantity: 1000, price: 120 })),
  };
  const imports = await Promise.all(Array.from({ length: 5 }, () => call("races", 9002, { name: "import", path: "/transactions/import", method: "POST", body: importBody, token: other.idToken, expect: [200, 201, 409] })));
  const importRows = await prisma.stockTransaction.count({ where: { firebaseUid: other.uid, symbol: "2412" } });
  out.push({ name: "duplicate concurrent import", ok: importRows === 20 && no5xx(imports), detail: `rows=${importRows} (expect 20) statuses=${statuses(imports)}` });
  const importId = imports.map((r) => (r.json as { importId?: string | null })?.importId).find(Boolean);
  if (importId) {
    const dels = await Promise.all(Array.from({ length: 3 }, () => call("races", 9002, { name: "import-delete", path: `/transactions/import/${importId}`, method: "DELETE", token: other.idToken, expect: [200, 404] })));
    const left = await prisma.stockTransaction.count({ where: { firebaseUid: other.uid, symbol: "2412" } });
    out.push({ name: "concurrent import delete", ok: left === 0 && no5xx(dels), detail: `rows left=${left} statuses=${statuses(dels)}` });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function seedPortfolio(user: EphemeralUser, i: number): Promise<void> {
  // 每個登入 VU 一份真實的帳本：幾檔股票、跨兩年，讓 performance／risk 有真的計算量。
  const picks = symbols.slice(i * 5, i * 5 + 5);
  const transactions = picks.flatMap((symbol, k) => [
    { externalRef: `seed-${k}-a`, tradeDate: "2024-03-04", symbol, action: "BUY", quantity: 1000, price: 50 },
    { externalRef: `seed-${k}-b`, tradeDate: "2025-06-02", symbol, action: "BUY", quantity: 1000, price: 60 },
  ]);
  await call("setup", 10_000 + i, { name: "seed-import", path: "/transactions/import", method: "POST", body: { source: "yuanta-csv", transactions }, token: user.idToken, expect: [200, 201] });
  for (const symbol of picks.slice(0, 3)) await call("setup", 10_000 + i, { name: "seed-watchlist", path: "/watchlist", method: "POST", body: { symbol }, token: user.idToken, expect: [201] });
}

async function main(): Promise<void> {
  if (!nitroKey) console.warn("! NITRO_SHARED_SECRET 沒設：所有匿名請求共用一個 300/分 的限流桶，到達率請壓在 4 req/s 以下。");
  const webApiKey = process.env.FIREBASE_WEB_API_KEY;
  if (!webApiKey) throw new Error("FIREBASE_WEB_API_KEY is not set — see .env's comment (not a secret).");

  const list = (await call("setup", 0, { name: "stocks", path: "/stocks?limit=1000" })).json as { entries?: { symbol: string; isEmerging: boolean }[] };
  symbols = (list.entries ?? []).filter((e) => !e.isEmerging).map((e) => e.symbol);
  if (symbols.length < 100) throw new Error(`GET /stocks returned only ${symbols.length} symbols — is ${BASE_URL} up?`);
  samples.length = 0; // setup 不算進報告

  const app = initializeApp({ credential: cert("serviceAccountKey.json") });
  const auth = getAuth(app);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const created: string[] = [];
  let passed = false;
  try {
    const userCount = MODE === "races" ? 2 : MODE === "smoke" ? 1 : Number(args.users);
    for (let i = 0; i < userCount; i++) authUsers.push(await createEphemeralUser(auth, "load-test", webApiKey, created));
    if (MODE !== "races") for (const [i, u] of authUsers.entries()) await seedPortfolio(u, i);
    samples.length = 0;
    stableHashes.clear();
    runStart = performance.now();
    startRssSampler();
    // ID token 一小時過期，長的模式中途換新（IAM token 也是）。
    const refresher = setInterval(() => {
      for (const u of authUsers) void u.refreshToken();
      if (TARGET === "dev") iamToken = sh("gcloud auth print-identity-token");
    }, 40 * 60_000);

    const windows: { label: string; from: number; to: number }[] = [];
    try {
      if (MODE === "smoke") {
        for (const name of Object.keys(JOURNEY_WEIGHTS) as JourneyName[]) await runJourney(name);
        passed = report([]);
      } else if (MODE === "load" || MODE === "soak") {
        const rate = Number(args.rate ?? (MODE === "load" ? 3 : 2));
        const minutes = Number(args.minutes ?? (MODE === "load" ? 10 : 30));
        for (let m = 0; m < minutes; m += 5) windows.push({ label: `min ${m}-${Math.min(m + 5, minutes)}`, ...(await drive(rate, Math.min(5, minutes - m) * 60, MODE)) });
        passed = report(windows);
      } else if (MODE === "ramp") {
        const steps = (args.rate ?? "1,2,4,6,8,12,16,24").split(",").map(Number);
        const stepSeconds = Number(args["step-seconds"]);
        let baselineP95 = 0;
        for (const rate of steps) {
          const w = { label: `${rate} j/s`, ...(await drive(rate, stepSeconds, `ramp ${rate}`)) };
          windows.push(w);
          const s = summarize(samples.filter((x) => x.at >= w.from && x.at < w.to));
          baselineP95 ||= s.p95;
          console.log(`  step ${rate} j/s: p95 ${s.p95}ms unexpected ${s.unexpected} busy ${s.busy}`);
          if (s.p95 > baselineP95 * 3 || s.unexpected / s.n > 0.01 || s.busy > 0) {
            console.log(`  knee reached at ${rate} j/s (p95 ${s.p95} vs ${baselineP95} at the first step, unexpected ${s.unexpected}, busy ${s.busy})`);
            break;
          }
        }
        passed = report(windows);
      } else if (MODE === "spike") {
        const burst = Number(args.rate ?? 50);
        const t0 = performance.now() - runStart;
        await Promise.all(Array.from({ length: burst }, () => runJourney(pick(weighted))));
        windows.push({ label: `burst of ${burst}`, from: t0, to: performance.now() - runStart });
        passed = report(windows);
      } else if (MODE === "races") {
        const results = await races(prisma, authUsers[0]!, authUsers[1]!);
        console.log("\n=== races ===");
        for (const r of results) console.log(`  ${r.ok ? "✓ PASS" : "✗ FAIL"} ${r.name} — ${r.detail}`);
        passed = report([], { races: results }) && results.every((r) => r.ok);
      }
    } finally {
      clearInterval(refresher);
      if (rssTimer) clearInterval(rssTimer);
    }
  } finally {
    console.log("\nCleaning up ephemeral accounts...");
    for (const uid of created) await deleteEphemeralUser(auth, prisma, uid);
    const leftovers = await prisma.stockTransaction.count({ where: { firebaseUid: { in: created } } });
    console.log(`  ${created.length} accounts deleted, ${leftovers} transaction rows left (expect 0)`);
    await prisma.$disconnect();
  }
  process.exitCode = passed ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error("load-test crashed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
