import type { Request } from "ultimate-express";
import type { DecodedIdToken } from "firebase-admin/auth";

export interface AuthenticatedRequest extends Request {
  user?: DecodedIdToken;
}
