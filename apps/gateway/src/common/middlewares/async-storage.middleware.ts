import { setupAsyncStorage } from "@bootstrap/logger/asyncStorage";
import { UUID } from "node:crypto";

import { Injectable, NestMiddleware } from "@nestjs/common";

@Injectable()
export class AsyncStorageMiddleware implements NestMiddleware {
  constructor() {}
  use(_req: Request, _res: Response, next: (error?: unknown) => void): void {
    if (_req.headers["lix-trace-id"] !== undefined) {
      setupAsyncStorage("gateway", _req.headers["lix-trace-id"] as UUID);
    } else {
      setupAsyncStorage("gateway");
    }
    next();
  }
}
