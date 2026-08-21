import express from "ultimate-express";
import { authRouter } from "./domains/auth/index.js";
import { systemRouter } from "./domains/system/index.js";
import { userRouter } from "./domains/user/index.js";
import { errorHandler, notFoundHandler } from "./shared/errorHandler.js";

export function createApp() {
  const app = express();

  app.use(express.json());

  app.use("/system", systemRouter);
  app.use("/auth", authRouter);
  app.use("/users", userRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
