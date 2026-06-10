import { Controller, Get, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import Redis from 'ioredis';
import * as amqp from 'amqplib';
import { MSG, RpcClientService } from '@app/common';
import { Public } from '../../common/decorators/public.decorator';

const RPC_PING_TIMEOUT_MS = 1_000;

/**
 * Health probes must not be rate-limited. The default 100/min throttler
 * keys by req.ip; the kubelet's liveness probe shares its source IP with
 * (a) other in-cluster traffic and (b) any client traffic ingress is
 * forwarding to this same upstream — once that bucket fills, /health
 * starts returning 429 and k8s kills the pod for failing liveness.
 * Witnessed 2026-05-25 on prod gateway (3 restarts in a day).
 */
@SkipThrottle()
@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly health: HealthCheckService,
    private readonly config: ConfigService,
    private readonly rpc: RpcClientService,
  ) {}

  /**
   * Deep readiness probe. Verifies edge deps (Redis + RabbitMQ) and pings
   * each microservice over RPC so the load balancer doesn't keep routing
   * traffic to a gateway whose downstream is in CrashLoopBackOff (we hit
   * exactly that on 2026-04-24 — gateway green, user-service crash-looped
   * for 65 minutes, every request returned 504).
   *
   * Use this for k8s `readinessProbe` — if any backend is down, gateway
   * gets removed from the Service endpoints until it recovers.
   */
  @Public()
  @Get()
  @HealthCheck()
  @ApiOperation({
    summary: 'Deep health: Redis + RabbitMQ + RPC ping to microservices',
  })
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.pingRedis(),
      () => this.pingRabbit(),
      () => this.pingService('user'),
    ]);
  }

  /**
   * Lightweight liveness probe. Doesn't fan out to RPC peers — k8s should
   * only restart the gateway pod itself when *this* process is wedged, not
   * because a downstream is briefly unavailable. Use this for
   * `livenessProbe` and the deep check for `readinessProbe`.
   */
  @Public()
  @Get('live')
  @HealthCheck()
  @ApiOperation({ summary: 'Liveness: Redis + RabbitMQ only' })
  live(): Promise<HealthCheckResult> {
    return this.health.check([() => this.pingRedis(), () => this.pingRabbit()]);
  }

  // Minimal indicators — no long-lived connection objects for the probe
  // because gateway is HTTP-only; RabbitMQ is used via ClientProxy elsewhere
  // and Redis via TokenStoreService. Keeping probes cheap and disposable.

  private async pingRedis(): Promise<HealthIndicatorResult> {
    const url = this.config.get<string>('REDIS_URL');
    if (!url)
      return { redis: { status: 'up', note: 'REDIS_URL unset — skipped' } };
    const redis = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
    });
    try {
      await redis.connect();
      const pong: unknown = await redis.ping();
      if (pong !== 'PONG') throw new Error(`unexpected reply: ${String(pong)}`);
      return { redis: { status: 'up' } };
    } catch (err) {
      return {
        redis: { status: 'down', message: (err as Error).message },
      };
    } finally {
      void redis.quit().catch(() => void 0);
    }
  }

  private async pingRabbit(): Promise<HealthIndicatorResult> {
    const url = this.config.get<string>('RABBITMQ_URL');
    if (!url)
      return { rabbit: { status: 'up', note: 'RABBITMQ_URL unset — skipped' } };
    let conn: amqp.ChannelModel | undefined;
    try {
      conn = await amqp.connect(url, { timeout: 2_000 });
      await conn.close();
      return { rabbit: { status: 'up' } };
    } catch (err) {
      try {
        await conn?.close();
      } catch {
        /* noop */
      }
      return {
        rabbit: { status: 'down', message: (err as Error).message },
      };
    }
  }

  /**
   * RPC ping with a tight 1s budget — RMQ ack must come back fast or the
   * service is treated as down. Returning a `down` indicator (rather than
   * throwing) lets HealthCheckService aggregate all three results into a
   * single 503 with each peer's status spelt out.
   */
  private async pingService(service: 'user'): Promise<HealthIndicatorResult> {
    try {
      await this.rpc[service]<{ ok: boolean }>(
        MSG.PING,
        {},
        RPC_PING_TIMEOUT_MS,
      );
      return { [service]: { status: 'up' } };
    } catch (err) {
      return {
        [service]: { status: 'down', message: (err as Error).message },
      };
    }
  }
}
