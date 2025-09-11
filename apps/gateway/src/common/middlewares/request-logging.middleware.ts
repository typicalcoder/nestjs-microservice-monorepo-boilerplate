import { Response } from 'express';
import { getLogger } from '@bootstrap/logger';
import { LixRequest } from '@bootstrap/types/request.type';

import { Injectable, NestMiddleware } from '@nestjs/common';

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  use(req: LixRequest, res: Response, next: (error?: unknown) => void): void {
    const body = req.body as unknown;
    const params = req.params as unknown;
    const query = req.query as unknown;
    const path = req.originalUrl;
    const method = req.method;
    const now = Date.now();
    res.on('finish', () => {
      getLogger().info(
        `${method} ${path} ${res.statusCode} ${Date.now() - now}ms`,
        {
          body,
          params,
          query,
        },
      );
    });
    next();
  }
}
