import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

export interface RequestContext {
  traceId: string;
  /** Service name that originated the inbound request, e.g. 'gateway' | 'user' */
  origin?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function getTraceId(): string | undefined {
  return requestContext.getStore()?.traceId;
}

export function getOrCreateTraceId(): string {
  return requestContext.getStore()?.traceId ?? generateTraceId();
}

export function generateTraceId(): string {
  return `tr_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}
