import { IsOptional, IsString } from 'class-validator';

/**
 * Minimal typed env shape for short-lived task runners (cron pods that
 * open a Mongo connection, do work, exit). No RabbitMQ — tasks don't
 * publish/consume events on the shared bus; they run to completion and
 * `process.exit` cleanly.
 */
export class MongoTaskConfig {
  @IsString()
  MONGO!: string;

  @IsString()
  MONGO_DB!: string;
}

/**
 * Shared env shape for long-running microservices.
 * Every service needs a Mongo connection for domain writes and a RabbitMQ
 * url for RPC + topic-exchange events.
 */
export class ServiceConfig extends MongoTaskConfig {
  @IsString()
  RABBITMQ_URL!: string;

  // Prefix applied to every RMQ queue name so dev/staging/prod stages that
  // share a broker don't cross-deliver. Defaults to NODE_ENV in getQueuePrefix
  // if unset. All services and the gateway MUST resolve to the same prefix or
  // RPCs time out silently (queues never overlap).
  @IsOptional()
  @IsString()
  RMQ_QUEUE_PREFIX?: string;
}
