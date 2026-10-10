import type { NextFunction, Response } from "ultimate-express";
import type { AuthenticatedRequest } from "@/http/authenticatedRequest.js";
import type { AppDeps } from "@/application/deps.js";

export type UserWriteLockDeps = Pick<AppDeps, "userWriteLock">;

/**
 * 最長持有時間。回應送出（finish）就會釋放；但客戶端中途斷線時，這個 stack（ultimate-express／uWebSockets）
 * 不保證發 finish 或 close（見 requestLogger.ts），所以要有程式端的上限。比等上游的 10 秒長得多，正常請求碰不到。
 */
const MAX_HOLD_MS = 30_000;

/** 拿這個使用者的寫入鎖，綁到這個回應的結束上。回傳的函式可以提早釋放（例如配額不足、要直接回錯時）。 */
export async function holdUserWriteLock(firebaseUid: string, res: Response, deps: UserWriteLockDeps): Promise<() => void> {
  const release = await deps.userWriteLock.acquire(firebaseUid);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    void release();
  };
  const timer = setTimeout(finish, MAX_HOLD_MS);
  res.on("finish", finish);
  res.on("close", finish);
  return finish;
}

/**
 * 同一個使用者的寫入排隊（理由見 application/ports/userWriteLock.ts）。掛在會改帳本的 router 上、排在 requireAuth
 * 之後；GET／HEAD 直接放行，讀不必排隊。配額保護的建立走 enforceQuota，它自己會拿同一把鎖。
 */
export function serializeUserWrites(deps: UserWriteLockDeps) {
  return async function userWriteLock(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    const firebaseUid = req.user?.uid;
    if (!firebaseUid || req.method === "GET" || req.method === "HEAD") {
      next();
      return;
    }
    try {
      await holdUserWriteLock(firebaseUid, res, deps);
      next();
    } catch (error) {
      next(error);
    }
  };
}
