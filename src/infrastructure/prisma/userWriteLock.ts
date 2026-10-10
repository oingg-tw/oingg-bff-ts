import pg from "pg";
import { AppError } from "@/domain/appError.js";
import { requireEnv } from "@/shared/env.js";
import type { UserWriteLockPort } from "@/application/ports/userWriteLock.js";

/**
 * UserWriteLockPort 的 Postgres 實作：在一個開著的交易裡拿 `pg_advisory_xact_lock`，交易一直開著直到釋放才
 * COMMIT——鎖跟著交易走，所以 Neon 的 PgBouncer（transaction pooling）也成立，跨 instance 也是同一把鎖。
 *
 * **用自己的小連線池，不借 Prisma 的**：排隊等鎖的請求每個都占著一條連線，借 Prisma 那 10 條的話，同一個
 * 使用者一陣並發就能把整台 instance 的 DB 連線卡住，連拿到鎖的那一個都要不到連線做事。
 * ponytail: 每台 instance 同時最多 USER_WRITE_LOCK_POOL_SIZE（預設 5）個使用者在寫，其餘在池子裡排隊；
 * 寫入很少所以夠用，寫入量上來時調大這個 env。
 *
 * 兩道保險，避免鎖放不掉：
 * - lock_timeout 15 秒：排太久就放棄，回 409 write_in_progress（前端重試即可），不無限等。
 * - idle_in_transaction_session_timeout 60 秒：這條連線的交易在等 handler 的時候是 idle 的；process 掛了或
 *   釋放漏掉時，Postgres 自己斷線、鎖跟著放掉。http 層另有程式端的最長持有時間（userWriteLock.middleware.ts）。
 */
const POOL_SIZE = Number(process.env.USER_WRITE_LOCK_POOL_SIZE ?? 5);

let pool: pg.Pool | undefined;
function lockPool(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: requireEnv("DATABASE_URL"), max: POOL_SIZE, connectionTimeoutMillis: 15_000 });
  return pool;
}

function busy(): AppError {
  return new AppError("Another change to your data is still being saved — try again in a moment", 409, undefined, "write_in_progress");
}

export const pgUserWriteLock: UserWriteLockPort = {
  async acquire(firebaseUid) {
    let client: pg.PoolClient;
    try {
      client = await lockPool().connect();
    } catch {
      throw busy(); // 池子排隊超過 connectionTimeoutMillis
    }
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '15s'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '60s'");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`user-write:${firebaseUid}`]);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release(true);
      if ((error as { code?: string }).code === "55P03") throw busy();
      throw error;
    }
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      try {
        await client.query("COMMIT");
        client.release();
      } catch {
        client.release(true); // 連線已被 Postgres 斷掉（idle timeout）：丟掉，不放回池子
      }
    };
  },
};
