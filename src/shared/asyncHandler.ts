import type { NextFunction, Request, Response } from "ultimate-express";

type AsyncRequestHandler<Req extends Request = Request> = (
  req: Req,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;

export function asyncHandler<Req extends Request = Request>(handler: AsyncRequestHandler<Req>) {
  return (req: Req, res: Response, next: NextFunction): void => {
    handler(req, res, next).catch(next);
  };
}
