/**
 * RMQ queue names, one per microservice. The gateway resolves a peer's queue
 * via SERVICE_TOKENS → QUEUES; each microservice declares its own in its
 * bootstrapService() call. Add a new service here, in SERVICE_TOKENS, and in
 * MessagingModule's ALL_SERVICES list to wire it into the RPC client.
 */
export const QUEUES = {
  USER_SERVICE: 'user_service_queue',
} as const;

/**
 * Returns the stage (dev/staging/prod/...) used to namespace RMQ queues.
 * Pull from RMQ_QUEUE_PREFIX if set, else fall back to NODE_ENV.
 * Must resolve the same on gateway and microservice or they won't connect.
 */
export function getQueuePrefix(): string {
  const explicit = process.env['RMQ_QUEUE_PREFIX'];
  if (explicit && explicit.trim()) return explicit.trim();
  const env = process.env['NODE_ENV']?.trim() ?? 'dev';
  return env;
}

export function prefixedQueue(queue: string): string {
  return `${getQueuePrefix()}_${queue}`;
}

/** Topic exchanges for fan-out domain events (see EventBusService). */
/**
 * RPC message patterns. Each is a `@MessagePattern` handler on some
 * microservice and a `rpc.<service>(MSG.X, payload)` call on the gateway.
 */
export const MSG = {
  // Generic — every microservice answers this so the gateway /health
  // probe can tell whether each backend is reachable.
  PING: 'ping',

  // ─── Auth / user identity (handled by user-service) ───────────────────────
  CREATE_AUTOREG_USER: 'create_autoreg_user',
  LOGIN_USER: 'login_user',
  UPGRADE_USER_ACCOUNT: 'upgrade_user_account',
  FIND_OR_CREATE_OAUTH_USER: 'find_or_create_oauth_user',
  FORGOT_PASSWORD: 'forgot_password',
  RESET_PASSWORD: 'reset_password',

  // ─── User profile ─────────────────────────────────────────────────────────
  GET_USER_BY_ID: 'get_user_by_id',
  // Minimal-exposure read for /auth/refresh — returns only the current
  // `tokenVersion` so the refresh handler can compare it to the `tv` claim
  // in the presented refresh JWT. Doesn't leak any other user state.
  GET_USER_TOKEN_VERSION: 'get_user_token_version',
  UPDATE_USER: 'update_user',
  DELETE_USER: 'delete_user',
} as const;

export const SERVICE_TOKENS = {
  USER_SERVICE: 'USER_SERVICE',
} as const;
