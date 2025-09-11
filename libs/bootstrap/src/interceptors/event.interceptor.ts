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
    const data = context.switchToRpc().getData<object>();
    const traceId: string =
      ('__traceId' in data && data?.__traceId && (data?.__traceId as string)) ??
      randomUUID();
    asyncStorage.enterWith({
      logger: getLogger().child({ traceId: traceId }),
      rpcContext: context.switchToRpc(),
      traceId,
      serviceName: process.env.SERVICE_NAME,
    });
    return next.handle();
  }
}
