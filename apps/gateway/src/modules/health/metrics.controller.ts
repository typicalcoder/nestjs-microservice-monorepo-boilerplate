import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { metricsRegistry } from '@app/common';
import { Public } from '../../common/decorators/public.decorator';

/**
 * Prometheus scrape endpoint. The gateway already speaks
 * HTTP, so we expose /metrics as a Nest controller here. RPC-only
 * services use the separate `startMetricsServer`
 * listener — same registry, separate port.
 *
 * Hidden from Swagger because it's an infra surface and the response
 * is text/plain, not JSON.
 */
@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  @Public()
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  metrics(): Promise<string> {
    return metricsRegistry.metrics();
  }
}
