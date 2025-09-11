import { UserEntity } from '@bootstrap/repository/entities/user.entity';

import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

import { RepositoryController } from './repository.controller';
import { RepositoryService } from './repository.service';

@Module({
  providers: [RepositoryService],
  imports: [MikroOrmModule.forFeature([UserEntity])],
  controllers: [RepositoryController],
})
export class RepositoryModule {}
