import { randomUUID } from 'crypto';
import { Observable } from 'rxjs';
import { getLogger } from '@bootstrap/logger';
import { asyncStorage } from '@bootstrap/logger/asyncStorage';

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';

@Injectable()
export class EventInterceptor implements NestInterceptor {
  constructor() {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'rpc') {
      return next.handle();
    }
    const traceId = context.switchToRpc().getData()?.__traceId ?? randomUUID();
    asyncStorage.enterWith({
      logger: getLogger().child({ traceId: traceId }),
      rpcContext: context.switchToRpc(),
      traceId,
      serviceName: process.env.SERVICE_NAME,
    });
    return next.handle();
  }
}
