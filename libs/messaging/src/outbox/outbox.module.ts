import { Global, Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { OutboxEvent } from '@app/database';
import { OutboxDispatcher } from './outbox.service';

/**
 * Generic outbox wiring. Imported by services that produce events with
 * at-least-once requirements. The dispatcher polls
 * the OutboxEvent collection; callers stage rows via stageOutboxEvent().
 */
@Global()
@Module({
  imports: [MikroOrmModule.forFeature([OutboxEvent])],
  providers: [OutboxDispatcher],
  exports: [OutboxDispatcher, MikroOrmModule],
})
export class OutboxModule {}
