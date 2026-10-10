import { EventEmitter } from "node:events";
import type { Response } from "ultimate-express";
import type { UserWriteLockPort } from "@/application/ports/userWriteLock.js";

/** 程序內、以 uid 分的互斥鎖：跟真的 advisory lock 一樣讓同一個使用者的請求排隊，並發測試才有意義。 */
export function fakeUserWriteLock(): UserWriteLockPort {
  const tails = new Map<string, Promise<void>>();
  return {
    async acquire(uid) {
      const previous = tails.get(uid) ?? Promise.resolve();
      let unlock!: () => void;
      const mine = new Promise<void>((resolve) => (unlock = resolve));
      tails.set(uid, previous.then(() => mine));
      await previous;
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        unlock();
      };
    },
  };
}

/** 有 on()／emit() 的假回應：holdUserWriteLock 把釋放綁在 finish 上，測試用 emit("finish") 模擬回應送出。 */
export function fakeResponse(): Response & EventEmitter {
  return new EventEmitter() as unknown as Response & EventEmitter;
}
