import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '@app/database';
import { MessagingModule, OutboxModule } from '@app/messaging';
import { requireEnv, validateEnvWith } from '@app/common';
import { UserConfig } from './config/user.config';
import { UsersModule } from './modules/users/users.module';
import { EmailModule } from './modules/email/email.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      validate: validateEnvWith(UserConfig),
    }),
    DatabaseModule.forRoot({
      uri: requireEnv('MONGO'),
      dbName: requireEnv('MONGO_DB'),
    }),
    // No peers — this leaf service is only an RPC callee. `forPeers([])` still
    // wires RpcClientService (for publishEvent) + the event bus. When you add
    // a peer service, list its token here and pass `selfQueue` / `subscribesTo`
    // to receive fan-out events.
    MessagingModule.forPeers(
      {
        url: requireEnv('RABBITMQ_URL'),
        selfQueue: 'user_service_queue',
      },
      [],
    ),
    OutboxModule,
    EmailModule,
    UsersModule,
  ],
})
export class UserAppModule {}
