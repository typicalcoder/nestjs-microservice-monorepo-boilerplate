import { Module } from '@nestjs/common';
import { DatabaseModule, Device, User } from '@app/database';
import { UserPurgeTask } from './task.service';

@Module({
  imports: DatabaseModule.forTask([User, Device]),
  providers: [UserPurgeTask],
})
export class UserPurgeModule {}
