/**
 * Tiny HTTP server that serves the Prometheus registry on a single
 * endpoint. RPC-only microservices speak only RMQ — they
 * have no Nest HTTP surface — so we open a separate listener on a
 * dedicated port for Prometheus to scrape.
 *
 * Gateway already runs Nest HTTP and exposes /metrics through a
 * controller (apps/gateway/src/modules/health/metrics.controller.ts);
 * this file is exclusively for the RPC-only services.
 *
 * Skipped silently if `METRICS_PORT` is unset, so dev / local runs
 * don't fight for ports.
 */
import * as http from 'http';
import { Logger } from '@nestjs/common';
import { metricsRegistry } from './metrics';

let server: http.Server | undefined;

export function startMetricsServer(
  serviceName: string,
): http.Server | undefined {
  const portStr = process.env['METRICS_PORT'];
  if (!portStr) return undefined;
  const port = Number(portStr);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    new Logger(`Metrics:${serviceName}`).warn(
      `METRICS_PORT='${portStr}' is not a valid port — metrics endpoint disabled`,
    );
    return undefined;
  }

  const logger = new Logger(`Metrics:${serviceName}`);
  server = http.createServer((req, res) => {
    if (req.url !== '/metrics') {
      res.writeHead(404).end();
      return;
    }
    metricsRegistry
      .metrics()
      .then((body) => {
        res.writeHead(200, { 'Content-Type': metricsRegistry.contentType });
        res.end(body);
      })
      .catch((err: unknown) => {
        logger.warn(`failed to render metrics: ${(err as Error).message}`);
        res.writeHead(500).end();
      });
  });
  server.listen(port, '0.0.0.0', () => {
    logger.log(`Prometheus /metrics listening on :${port}`);
  });
  return server;
}

export function stopMetricsServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
    server = undefined;
  });
}
