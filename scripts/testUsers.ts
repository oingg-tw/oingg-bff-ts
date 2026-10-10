/**
 * 臨時測試帳號，security-check 與 load-test 共用（2026-10-11 從 security-check 抽出來）。
 *
 * 規矩跟 security-check 原本的一樣：密碼與 token 只活在這個 process 的變數裡，**永遠不印出來**
 * （[[feedback_no_plaintext_secrets_in_chat]]）；呼叫端用 try/finally 呼叫 deleteEphemeralUser，跑完
 * Firebase 與 DB 都不留帳號。
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { Auth } from "firebase-admin/auth";
import type { PrismaClient } from "../src/generated/prisma/client.js";

export interface EphemeralUser {
  uid: string;
  idToken: string;
  /** Firebase ID token 一小時過期；跑得比較久的模式（soak）在中途換新。 */
  refreshToken(): Promise<void>;
}

/**
 * 建帳號並登入。uid 在登入**之前**就推進 `created`，所以登入失敗時 finally 一樣刪得到這個帳號。
 */
export async function createEphemeralUser(auth: Auth, prefix: string, webApiKey: string, created: string[]): Promise<EphemeralUser> {
  const email = `${prefix}-${randomUUID()}@oingg-test.internal`;
  const password = randomBytes(24).toString("base64url");
  const user = await auth.createUser({ email, password, displayName: prefix });
  created.push(user.uid);
  const result: EphemeralUser = {
    uid: user.uid,
    idToken: await signIn(email, password, webApiKey),
    async refreshToken() {
      result.idToken = await signIn(email, password, webApiKey);
    },
  };
  return result;
}

async function signIn(email: string, password: string, webApiKey: string): Promise<string> {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${webApiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!response.ok) {
    throw new Error(`Firebase sign-in failed with status ${response.status}`);
  }
  const body = (await response.json()) as { idToken?: string };
  if (!body.idToken) {
    throw new Error("Firebase sign-in response is missing idToken");
  }
  return body.idToken;
}

/**
 * 刪掉這個 uid 在**每一張**有 firebase_uid 欄位的表裡的列，再刪 Firebase 帳號。表清單從
 * information_schema 現查，不手列：security-check 原本逐表列舉，漏了 users（每次跑都留一列）——新增
 * per-user 表時也不必記得回來改這裡。每張表都限定 `WHERE firebase_uid = $1`，不是整表清空
 * （[[feedback_scoped_deletes_over_bulk]]）。preset 的子表靠 FK cascade 一起刪。
 */
export async function deleteEphemeralUser(auth: Auth, prisma: PrismaClient, uid: string): Promise<void> {
  const tables = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'firebase_uid'`;
  // 兩輪：哪天出現沒有 cascade 的 per-user FK 時，第一輪被擋下的那張表在第二輪就刪得掉。
  for (let pass = 0; pass < 2; pass++) {
    for (const { table_name } of tables) {
      await prisma.$executeRawUnsafe(`DELETE FROM "${table_name}" WHERE firebase_uid = $1`, uid).catch(() => undefined);
    }
  }
  await auth.deleteUser(uid).catch(() => undefined);
}
