import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import { UUID } from 'node:crypto';
import { Logger } from 'winston';
import { getLogger } from '@bootstrap/logger';

import { RpcArgumentsHost } from '@nestjs/common/interfaces';

export type AsyncStorage = {
  logger: Logger;
  traceId: string;
  serviceName: string;
  rpcContext?: RpcArgumentsHost;
};

export const asyncStorage = new AsyncLocalStorage<AsyncStorage>();
export const getAsyncStorage = (): AsyncStorage | undefined =>
  asyncStorage.getStore();

export const setupAsyncStorage = (
  serviceName: string,
  traceId?: UUID,
): void => {
  if (!traceId) {
    traceId = randomUUID();
  }
  const childLogger = getLogger().child({
    traceId,
  });
  asyncStorage.enterWith({
    traceId,
    logger: childLogger,
    serviceName,
  });
};
