import { Logger, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { MikroORM, RequestContext } from '@mikro-orm/core';
import { buildLogger } from './telemetry';

export interface BootstrapTaskOptions {
  /** Logger context / telemetry label, e.g. 'tasks'. */
  serviceName: string;
}

/**
 * Bootstraps a standalone NestJS application context — no HTTP, no RMQ — runs
 * the provided handler, then exits. Intended for k8s Jobs / CronJobs.
 *
 * Exit codes:
 *   0 — handler resolved
 *   1 — handler threw, or context failed to close cleanly
 */
export async function bootstrapTask(
  module: Type,
  options: BootstrapTaskOptions,
  handler: (app: INestApplicationContext) => Promise<void>,
): Promise<void> {
  const nestLogger = buildLogger(options.serviceName);
  const logger = new Logger(`Bootstrap:${options.serviceName}`);

  let app: INestApplicationContext | undefined;
  try {
    // No `bufferLogs: true`: `createApplicationContext` runs `init()`
    // synchronously, which fires `OnApplicationBootstrap`. If a task's
    // module connects to an external dependency in a lifecycle hook and
    // that dependency is down, init blocks and the buffer never flushes
    // — same wedge pattern that previously hid an RMQ outage on the
    // gateway. Pass the custom `logger:` directly so winston picks up
    // every line from the start; the few pre-logger Nest lines going to
    // the default ConsoleLogger are an acceptable trade-off for visibility.
    app = await NestFactory.createApplicationContext(module, {
      logger: nestLogger,
    });
    app.enableShutdownHooks();
    // Always wrap in a MikroORM RequestContext if the container has one, so
    // handler code can use the injected EntityManager (global context access
    // is disallowed). Skip gracefully if the task happens to not use the ORM
    // (e.g. db-migrate talks to mongodb directly).
    //
    // `app.get(MikroORM, { strict: false })` is documented as returning
    // undefined for missing providers, but Nest 11 actually throws an
    // `Error: Nest could not find ... element`. Treat the throw as
    // "ORM absent" so optionality still works.
    let orm: MikroORM | undefined;
    try {
      orm = app.get(MikroORM, { strict: false });
    } catch {
      orm = undefined;
    }
    const appRef = app;
    if (orm) {
      await RequestContext.create(orm.em, () => handler(appRef));
    } else {
      await handler(appRef);
    }
    await app.close();
    process.exit(0);
  } catch (err) {
    const e = err as Error;
    logger.error(`${e.name ?? 'Error'}: ${e.message}`, e.stack);
    if (app) {
      try {
        await app.close();
      } catch (closeErr) {
        logger.error(`Close failed: ${(closeErr as Error).message}`);
      }
    }
    process.exit(1);
  }
}
