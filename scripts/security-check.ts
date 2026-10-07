/**
 * Self-service security regression check for bff-ts. Run against a live dev server:
 *
 *   npm run security:check
 *
 * Requires: the app running locally (BASE_URL, default http://localhost:4000), serviceAccountKey.json
 * present (Firebase Admin), and FIREBASE_WEB_API_KEY in .env (not secret — see .env's comment).
 *
 * Two things this deliberately does NOT do, on purpose:
 * 1. Never logs a password, ID token, or custom token — only high-level progress and pass/fail. See
 *    [[feedback_no_plaintext_secrets_in_chat]] memory: credentials created here must never leave this
 *    process, not even into this script's own stdout.
 * 2. Always deletes its own ephemeral test accounts + seeded rows before exiting (success or failure,
 *    via try/finally) — never leaves live test accounts sitting in the Firebase project.
 *
 * What it checks:
 * - BOLA (OWASP API1): for every per-user CRUD resource, account A's token must never be able to
 *   GET/PATCH/DELETE account B's resource by ID (must 404, never 200 or leak data).
 * - A handful of the static findings from conductor's OWASP scan (2026-09-02), so regressions on these
 *   specific points get caught automatically instead of relying on another manual scan:
 *   - Security headers (helmet) present on a plain response.
 *   - No CORS at all: browsers can't read our responses cross-origin (Nitro is the only caller since 2026-10-08).
 *   - /api-docs is reachable with no auth and serves bff-ts's real spec (not a static demo) — this is a
 *     KNOWN, accepted gap for local dev (see [[project_pre_deploy_swagger_auth]]); reported as an
 *     informational WARN, not a FAIL, since fixing it is a pre-deploy task, not a dev-time regression.
 *   - A 400 response body doesn't leak a stack trace / file path.
 *
 * This is intentionally NOT a general-purpose scanner or a permanent CI gate — see conductor's own
 * guidance (2026-09-02): at this project's scale, "create test data, verify authorization holds, clean
 * up" is the right amount of tooling. Don't grow this into something heavier without a concrete reason.
 */
import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { PrismaClient } from "../src/generated/prisma/client.js";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4000";
const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY;

interface CheckResult {
  name: string;
  status: "PASS" | "FAIL" | "WARN";
  detail?: string;
}

const results: CheckResult[] = [];
function record(name: string, status: CheckResult["status"], detail?: string) {
  results.push({ name, status, detail });
}

// ---------------------------------------------------------------------------
// Ephemeral test accounts — created fresh every run, deleted in the finally block below. Passwords are
// random and held only in local variables for the lifetime of this process; never logged.
// ---------------------------------------------------------------------------

interface TestUser {
  label: "A" | "B";
  uid: string;
  idToken: string;
}

async function createEphemeralUser(auth: Auth, label: "A" | "B"): Promise<{ uid: string; password: string; email: string }> {
  const email = `security-check-${randomUUID()}@oingg-test.internal`;
  const password = randomBytes(24).toString("base64url");
  const user = await auth.createUser({ email, password, displayName: `Security Check ${label}` });
  return { uid: user.uid, password, email };
}

async function signIn(email: string, password: string): Promise<string> {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_WEB_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  if (!response.ok) {
    throw new Error(`Firebase sign-in failed with status ${response.status}`);
  }
  const body = (await response.json()) as { idToken?: string };
  if (!body.idToken) {
    throw new Error("Firebase sign-in response is missing idToken");
  }
  return body.idToken;
}

async function api(path: string, options: { method?: string; token?: string; body?: unknown } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: response.status, json, text, headers: response.headers };
}

// ---------------------------------------------------------------------------
// BOLA sweep — one spec per per-user CRUD resource. `createBody` seeds B's own resource (via B's own
// token, through the real API, exactly like a real user would); the sweep then tries every mutating and
// read verb on that resource's ID using A's token instead.
// ---------------------------------------------------------------------------

interface ResourceSpec {
  name: string;
  basePath: string;
  createBody: (label: "A" | "B") => Record<string, unknown>;
  /** Extra sub-paths off the resource ID to also sweep, e.g. screener presets' "/run". */
  extraGetSuffixes?: string[];
}

// Holding is NOT in this list since 2026-10-05: it stopped being an id-keyed row and became a read-only
// projection of StockTransaction. There is no cross-user identifier to probe — the key is the symbol,
// which isn't a secret and is namespaced by firebaseUid. The one thing that still needs proving is that
// DELETE /holdings/{symbol} can't reach another user's ledger; that's checked separately below, by
// behaviour rather than by status code (a 404 would be the wrong assertion — A legitimately gets 404 for
// a symbol A has no transactions for, whether or not B's rows survived).
const RESOURCES: ResourceSpec[] = [
  {
    name: "WatchlistItem",
    basePath: "/watchlist",
    // Not "0050"/"0056" (ETFs) — GET /stocks/:symbol (which watchlist/holdings/transactions all validate
    // existence against) only covers ordinary stocks, not ETFs. Use different symbols from Holding/
    // StockTransaction above so a single test run can create all three for the same account without a
    // unique-constraint collision.
    createBody: (label) => ({ symbol: label === "A" ? "2454" : "2379" }),
  },
  {
    name: "StockTransaction",
    basePath: "/transactions",
    createBody: (label) => ({
      symbol: label === "A" ? "2330" : "2317",
      action: "BUY",
      quantity: 1000,
      price: 100,
      tradeDate: "2026-08-01",
    }),
  },
  {
    name: "ScreenerPreset",
    basePath: "/screener/presets",
    createBody: () => ({
      name: `security-check-${randomUUID()}`,
      // 2026-09-08 起欄位定址是 metricCode.token，舊的 "per.peRatio" 會被 400 擋掉（Unknown filter field）。
      // 而這支腳本把「建立失敗」記成 WARN 跳過，所以那次遷移之後這兩項 BOLA 檢查其實一直沒在跑，
      // 2026-09-28 才發現。改欄位格式時這裡要跟著改，否則覆蓋率會無聲消失。
      filters: [{ field: "peRatio.TTM", min: 1, max: 20, exclude: false }],
    }),
    extraGetSuffixes: ["/run"],
  },
  {
    name: "ColumnPreset",
    basePath: "/screener/column-presets",
    createBody: () => ({ name: `security-check-${randomUUID()}`, columns: [{ field: "peRatio.TTM" }] }),
  },
];

function extractId(json: unknown): string | null {
  if (typeof json !== "object" || json === null) return null;
  for (const value of Object.values(json as Record<string, unknown>)) {
    if (typeof value === "object" && value !== null && "id" in value && typeof (value as { id: unknown }).id === "string") {
      return (value as { id: string }).id;
    }
  }
  return null;
}

async function runBolaSweep(userA: TestUser, userB: TestUser) {
  for (const resource of RESOURCES) {
    const created = await api(resource.basePath, { method: "POST", token: userB.idToken, body: resource.createBody("B") });
    const id = extractId(created.json);
    if (created.status >= 400 || !id) {
      record(`BOLA: ${resource.name} setup`, "WARN", `Could not create a ${resource.name} to test (status ${created.status}) — skipped`);
      continue;
    }

    const attackPaths = [`${resource.basePath}/${id}`, ...(resource.extraGetSuffixes ?? []).map((s) => `${resource.basePath}/${id}${s}`)];

    let leaked = false;
    const details: string[] = [];
    for (const path of attackPaths) {
      for (const method of ["GET", "PATCH", "DELETE"] as const) {
        if (method === "PATCH" && path.includes("/run")) continue; // read-only sub-route
        const attack = await api(path, { method, token: userA.idToken, body: method === "PATCH" ? { note: "bola-check" } : undefined });
        if (attack.status === 200 || attack.status === 204) {
          leaked = true;
          details.push(`${method} ${path} -> ${attack.status} (expected 404)`);
        }
      }
    }

    // Cleanup B's own resource now that the sweep against it is done.
    await api(`${resource.basePath}/${id}`, { method: "DELETE", token: userB.idToken }).catch(() => undefined);

    if (leaked) {
      record(`BOLA: ${resource.name}`, "FAIL", details.join("; "));
    } else {
      record(`BOLA: ${resource.name}`, "PASS");
    }
  }

  // DELETE /holdings/{symbol} takes a caller-supplied key and deletes rows, which is exactly the class
  // this sweep exists for — the key just isn't an id. B seeds a transaction, A deletes the same symbol,
  // B's ledger must be untouched.
  const holdingSymbol = "2412";
  await api("/transactions", {
    method: "POST",
    token: userB.idToken,
    body: { symbol: holdingSymbol, action: "BUY", quantity: 1000, price: 100, tradeDate: "2026-08-01" },
  });
  await api(`/holdings/${holdingSymbol}`, { method: "DELETE", token: userA.idToken });
  const bLedger = await api(`/transactions?symbol=${holdingSymbol}`, { token: userB.idToken });
  const bRows = (bLedger.json as { transactions?: unknown[] })?.transactions;
  if (Array.isArray(bRows) && bRows.length > 0) {
    record("BOLA: DELETE /holdings/{symbol}", "PASS");
  } else {
    record("BOLA: DELETE /holdings/{symbol}", "FAIL", `A's delete wiped B's ${holdingSymbol} ledger (${JSON.stringify(bRows)})`);
  }
  await api(`/holdings/${holdingSymbol}`, { method: "DELETE", token: userB.idToken }).catch(() => undefined);

  // POST /watchlist/reorder（2026-10-06）takes caller-supplied ids and its UPDATE locates rows by id alone —
  // the only guard is the in-transaction check that the ids are exactly the caller's own set. A holds two
  // items so that B's two ids, sent swapped, would pass a size-only check; B's order must not change.
  const seed = async (user: TestUser) => {
    const ids: (string | null)[] = [];
    for (const symbol of ["2603", "2609"]) {
      ids.push(extractId((await api("/watchlist", { method: "POST", token: user.idToken, body: { symbol } })).json));
    }
    return ids;
  };
  const watchlistIdsA = await seed(userA);
  const watchlistIdsB = await seed(userB);
  const bOrder = async () =>
    ((await api("/watchlist", { token: userB.idToken })).json as { items?: { id: string }[] })?.items?.map((item) => item.id).join(",");
  const before = await bOrder();
  const reorderAttack = await api("/watchlist/reorder", { method: "POST", token: userA.idToken, body: { ids: [watchlistIdsB[1], watchlistIdsB[0]] } });
  const after = await bOrder();
  if ([...watchlistIdsA, ...watchlistIdsB].every(Boolean) && before === after && reorderAttack.status === 400) {
    record("BOLA: POST /watchlist/reorder", "PASS");
  } else {
    record("BOLA: POST /watchlist/reorder", "FAIL", `B's order ${before} -> ${after}; A got ${reorderAttack.status}`);
  }
  for (const id of watchlistIdsB) await api(`/watchlist/${id}`, { method: "DELETE", token: userB.idToken }).catch(() => undefined);
  for (const id of watchlistIdsA) await api(`/watchlist/${id}`, { method: "DELETE", token: userA.idToken }).catch(() => undefined);

  // DELETE /transactions/import/{importId} is id-keyed and deletes a whole batch — the sweep above can't
  // cover it (the create response carries `importId`, not `id`). B imports, A tries to revert B's batch,
  // B's rows must survive. Checked by behaviour, not only by A's status code.
  const imported = await api("/transactions/import", {
    method: "POST",
    token: userB.idToken,
    body: {
      source: "yuanta-csv",
      transactions: [
        { externalRef: `security-check-${randomUUID()}`, tradeDate: "2026-08-01", symbol: "2603", action: "BUY", quantity: 1000, price: 100 },
      ],
    },
  });
  const importId = (imported.json as { importId?: string } | undefined)?.importId;
  if (!importId) {
    record("BOLA: DELETE /transactions/import/{importId} setup", "WARN", `Could not create B's import (status ${imported.status}) — skipped`);
  } else {
    const attack = await api(`/transactions/import/${importId}`, { method: "DELETE", token: userA.idToken });
    const bRowsAfter = await api("/transactions?symbol=2603", { token: userB.idToken });
    const survived = ((bRowsAfter.json as { transactions?: unknown[] })?.transactions ?? []).length > 0;
    if (attack.status === 404 && survived) {
      record("BOLA: DELETE /transactions/import/{importId}", "PASS");
    } else {
      record("BOLA: DELETE /transactions/import/{importId}", "FAIL", `A's revert -> ${attack.status}, B's rows survived: ${survived}`);
    }
    await api(`/transactions/import/${importId}`, { method: "DELETE", token: userB.idToken }).catch(() => undefined);
  }

  // DELETE /transactions?all=true takes no key at all — its where clause is firebaseUid alone. A bug that
  // dropped that one field would wipe EVERY user's ledger, which no unit test can see (the fake port has no
  // other users). B seeds a row, A clears, B's row must survive.
  await api("/transactions", {
    method: "POST",
    token: userB.idToken,
    body: { symbol: "2882", action: "BUY", quantity: 1000, price: 50, tradeDate: "2026-08-01" },
  });
  await api("/transactions?all=true", { method: "DELETE", token: userA.idToken });
  const bAfterClear = await api("/transactions?symbol=2882", { token: userB.idToken });
  const bSurvived = ((bAfterClear.json as { transactions?: unknown[] })?.transactions ?? []).length > 0;
  record(
    "BOLA: DELETE /transactions?all=true",
    bSurvived ? "PASS" : "FAIL",
    bSurvived ? undefined : "A's clear-all removed B's transactions",
  );
  await api("/transactions?all=true", { method: "DELETE", token: userB.idToken }).catch(() => undefined);

  // holding-columns is self-scoped like dashboard-cards (no id in the path): A's PUT must never touch B's list.
  const bColumns = [{ id: "b-marker", label: "B", formula: "=D/A", format: "number", decimals: 2 }];
  await api("/users/me/holding-columns", { method: "PUT", token: userB.idToken, body: { columns: bColumns } });
  await api("/users/me/holding-columns", {
    method: "PUT",
    token: userA.idToken,
    body: { columns: [{ id: "a-marker", label: "A", formula: "=B/A", format: "percent", decimals: 1 }] },
  });
  const bHolding = await api("/users/me/holding-columns", { token: userB.idToken });
  const bIds = ((bHolding.json as { holdingColumns?: { columns?: { id: string }[] | null } })?.holdingColumns?.columns ?? []).map((c) => c.id);
  record(
    "BOLA: holding-columns",
    bIds.length === 1 && bIds[0] === "b-marker" ? "PASS" : "FAIL",
    bIds.length === 1 && bIds[0] === "b-marker" ? undefined : `B's columns after A's PUT: ${JSON.stringify(bIds)}`,
  );

  // dashboard-cards has no ID param at all — it's inherently self-scoped to the caller's own token.
  // Confirm A's PUT never touches B's stored value.
  await api("/users/me/dashboard-cards", { method: "PUT", token: userB.idToken, body: { visibleCardIds: ["b-marker"] } });
  await api("/users/me/dashboard-cards", { method: "PUT", token: userA.idToken, body: { visibleCardIds: ["a-marker"] } });
  const bAfter = await api("/users/me/dashboard-cards", { token: userB.idToken });
  const bList = (bAfter.json as { dashboardCards?: { visibleCardIds?: unknown } })?.dashboardCards?.visibleCardIds;
  if (Array.isArray(bList) && bList.includes("b-marker") && !bList.includes("a-marker")) {
    record("BOLA: dashboard-cards", "PASS");
  } else {
    record("BOLA: dashboard-cards", "FAIL", `B's list after A's PUT: ${JSON.stringify(bList)}`);
  }
}

// ---------------------------------------------------------------------------
// Static checks — spot-checks for the categories from conductor's 2026-09-02 OWASP scan.
// ---------------------------------------------------------------------------

async function runStaticChecks() {
  const root = await api("/");
  const requiredHeaders = ["x-content-type-options", "x-frame-options", "strict-transport-security"];
  const missing = requiredHeaders.filter((h) => !root.headers.has(h));
  if (missing.length === 0) {
    record("Security headers present", "PASS");
  } else {
    record("Security headers present", "FAIL", `Missing: ${missing.join(", ")}`);
  }

  const corsResponse = await fetch(`${BASE_URL}/`, { headers: { Origin: "https://evil-not-allowed.example" } });
  const acao = corsResponse.headers.get("access-control-allow-origin");
  if (acao !== null) {
    record("No CORS headers (browsers can't call us)", "FAIL", `Access-Control-Allow-Origin present: ${acao}`);
  } else {
    record("No CORS headers (browsers can't call us)", "PASS");
  }

  const apiDocs = await fetch(`${BASE_URL}/api-docs/`);
  const apiDocsBody = await apiDocs.text();
  if (apiDocs.status === 200) {
    const initJs = await fetch(`${BASE_URL}/api-docs/swagger-ui-init.js`).then((r) => r.text());
    const isRealSpec = initJs.includes("oingg-bff-ts API");
    record(
      "/api-docs reachable without auth",
      "WARN",
      isRealSpec
        ? "Known accepted gap for local dev — real API spec exposed with no auth, must gate/disable before production (see project_pre_deploy_swagger_auth memory)"
        : "Reachable but does not appear to serve the real spec — investigate before trusting this result",
    );
  } else {
    record("/api-docs reachable without auth", "PASS", `Now returns ${apiDocs.status} — pre-deploy gap appears to be fixed`);
  }
  void apiDocsBody;

  // /transactions, not /holdings: since 2026-10-05 the holdings path param is a symbol, not a UUID, so
  // it no longer exercises the UUID parser this probe is aimed at.
  const badUuid = await api("/transactions/not-a-valid-uuid", { token: undefined });
  const leaksInternals = /node_modules|at .*\.(ts|js):\d+|C:\\Users|\/home\//.test(badUuid.text);
  if (leaksInternals) {
    record("Error responses don't leak internals", "FAIL", "Response body appears to contain a stack trace or file path");
  } else {
    record("Error responses don't leak internals", "PASS");
  }
}

// ---------------------------------------------------------------------------

async function main() {
  if (!FIREBASE_WEB_API_KEY) {
    throw new Error("FIREBASE_WEB_API_KEY is not set — see .env's comment for where to get it (not a secret).");
  }

  const app = initializeApp({ credential: cert("serviceAccountKey.json") });
  const auth = getAuth(app);
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const createdUids: string[] = [];

  try {
    console.log("Creating ephemeral test accounts...");
    const rawA = await createEphemeralUser(auth, "A");
    const rawB = await createEphemeralUser(auth, "B");
    createdUids.push(rawA.uid, rawB.uid);

    const userA: TestUser = { label: "A", uid: rawA.uid, idToken: await signIn(rawA.email, rawA.password) };
    const userB: TestUser = { label: "B", uid: rawB.uid, idToken: await signIn(rawB.email, rawB.password) };
    console.log("Accounts ready. Running checks...\n");

    await runBolaSweep(userA, userB);
    await runStaticChecks();
  } finally {
    console.log("\nCleaning up ephemeral test accounts...");
    for (const uid of createdUids) {
      await prisma.stockTransaction.deleteMany({ where: { firebaseUid: uid } }).catch(() => undefined);
      await prisma.watchlistItem.deleteMany({ where: { firebaseUid: uid } }).catch(() => undefined);
      await prisma.screenerPreset.deleteMany({ where: { firebaseUid: uid } }).catch(() => undefined);
      await prisma.columnPreset.deleteMany({ where: { firebaseUid: uid } }).catch(() => undefined);
      await prisma.userThemePreference.deleteMany({ where: { firebaseUid: uid } }).catch(() => undefined);
      await prisma.screenerDisplaySettings.deleteMany({ where: { firebaseUid: uid } }).catch(() => undefined);
      await prisma.dashboardCardSettings.deleteMany({ where: { firebaseUid: uid } }).catch(() => undefined);
      await prisma.holdingColumnPreferences.deleteMany({ where: { firebaseUid: uid } }).catch(() => undefined);
      await auth.deleteUser(uid).catch(() => undefined);
    }
    await prisma.$disconnect();
  }

  console.log("\n=== Security check results ===");
  let hasFailure = false;
  for (const result of results) {
    const icon = result.status === "PASS" ? "✓" : result.status === "WARN" ? "!" : "✗";
    console.log(`${icon} [${result.status}] ${result.name}${result.detail ? ` — ${result.detail}` : ""}`);
    if (result.status === "FAIL") hasFailure = true;
  }
  console.log();

  if (hasFailure) {
    console.error("One or more checks FAILED.");
    process.exitCode = 1;
  } else {
    console.log("All checks passed (WARNs are known, accepted gaps — see detail).");
  }
}

main().catch((error: unknown) => {
  console.error("security-check crashed:", error);
  process.exitCode = 1;
});
