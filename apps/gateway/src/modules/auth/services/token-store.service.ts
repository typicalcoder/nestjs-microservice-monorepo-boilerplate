import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

const KEY_PREFIX = 'blacklist:rt:';

@Injectable()
export class TokenStoreService implements OnModuleDestroy {
  private readonly logger = new Logger(TokenStoreService.name);
  private readonly redis: Redis;

  constructor(config: ConfigService) {
    this.redis = new Redis(config.getOrThrow<string>('REDIS_URL'), {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
    });
    this.redis.on('error', (err) => {
      // ioredis exhausts maxRetriesPerRequest silently on individual commands
      // otherwise — surfacing the connection error at least lets ops see that
      // the refresh-token blacklist is degraded (logout → race-window grows).
      this.logger.error(`Redis error: ${err.message}`);
    });
    this.redis.on('reconnecting', () => {
      this.logger.warn('Redis reconnecting — blacklist checks may be stale');
    });
  }

  async blacklistRefreshToken(jti: string, expiresAt: number): Promise<void> {
    const ttl = expiresAt - Math.floor(Date.now() / 1000);
    if (ttl > 0) {
      await this.redis.set(`${KEY_PREFIX}${jti}`, '1', 'EX', ttl);
    }
  }

  async isBlacklisted(jti: string): Promise<boolean> {
    try {
      const val = await this.redis.get(`${KEY_PREFIX}${jti}`);
      return val === '1';
    } catch (err) {
      // Redis unavailable — fail-closed: refuse to accept any refresh token
      // whose blacklist status is unknown. A revoked token must not pass during
      // an outage. Clients will get 503 and can retry once Redis recovers.
      this.logger.error(
        `Blacklist check failed for jti=${jti}: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException({
        code: 'auth_store_unavailable',
        message: 'Authentication service temporarily unavailable',
      });
    }
  }

  onModuleDestroy(): void {
    void this.redis.quit();
  }
}
