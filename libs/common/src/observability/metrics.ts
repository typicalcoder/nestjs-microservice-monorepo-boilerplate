/**
 * Prometheus metrics registry shared across services. Each metric name
 * is prefixed `app_` so it survives co-tenancy with other apps
 * scraped by the same Prometheus instance (`monitoring` namespace,
 * loki-stack-prometheus-server).
 *
 * Usage from a service module:
 *   import { metrics, metricsRegistry } from '@app/common';
 *   metrics.outboxTerminalFailuresTotal.labels(target, pattern).inc();
 *
 * Bootstrap exposes /metrics on a separate HTTP port via
 * `startMetricsServer` (see bootstrap-service.ts) so RPC-only
 * microservices can be scraped without standing up a full Nest HTTP
 * surface. Gateway already speaks HTTP — it serves /metrics from a
 * controller.
 */
import * as client from 'prom-client';

export const metricsRegistry = new client.Registry();

// Default Node.js / process collectors (event loop lag, heap, gc, …)
client.collectDefaultMetrics({
  register: metricsRegistry,
  prefix: 'app_',
});

export const metrics = {
  /**
   * Counter incremented every time an outbox row reaches MAX_ATTEMPTS
   * and is marked `failed`. Pairs naturally with an alert
   *   `increase(app_outbox_terminal_failures_total[5m]) > 0`
   * for "an event was lost in the last 5 minutes".
   */
  outboxTerminalFailuresTotal: new client.Counter({
    name: 'app_outbox_terminal_failures_total',
    help: 'Outbox events that hit MAX_ATTEMPTS and were marked failed',
    labelNames: ['target', 'pattern'] as const,
    registers: [metricsRegistry],
  }),

  /**
   * Gauge of currently-pending outbox rows. Set on each sweep — a
   * value that won't drain points at a slow / dead consumer or a
   * dispatcher loop that's stalled.
   */
  outboxPending: new client.Gauge({
    name: 'app_outbox_pending',
    help: 'Outbox rows in `pending` status, sampled per sweep',
    registers: [metricsRegistry],
  }),

  /**
   * Gauge of terminally-failed rows. Should normally be 0; a non-zero
   * value means ops needs to inspect outbox_events. Alert:
   *   `app_outbox_failed > 0 for 5m`
   */
  outboxFailed: new client.Gauge({
    name: 'app_outbox_failed',
    help: 'Outbox rows in `failed` status, sampled per sweep',
    registers: [metricsRegistry],
  }),
};
