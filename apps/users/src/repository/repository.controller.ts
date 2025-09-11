import {
  GetUserCommandRequestPayload,
  GetUserCommandResponsePayload,
  ListUserCommandRequestPayload,
  ListUserCommandResponsePayload,
  UsersCommands,
} from '@microservice/lib/commands/users';
import {
  CreateUserCommandRequestPayload,
  CreateUserCommandResponsePayload,
} from '@microservice/lib/commands/users/create.users.command-payload';

import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';

import { RepositoryService } from './repository.service';

@Controller()
export class RepositoryController {
  constructor(private readonly repositoryService: RepositoryService) {}

  @MessagePattern(UsersCommands.get)
  async get(
    @Payload() data: GetUserCommandRequestPayload,
  ): Promise<GetUserCommandResponsePayload> {
    return new GetUserCommandResponsePayload(
      await this.repositoryService.get(data),
    );
  }

  @MessagePattern(UsersCommands.list)
  async list(
    @Payload() data: ListUserCommandRequestPayload,
  ): Promise<ListUserCommandResponsePayload> {
    return new ListUserCommandResponsePayload(
      await this.repositoryService.list(data.filter),
    );
  }

  @MessagePattern(UsersCommands.create)
  async create(
    @Payload() data: CreateUserCommandRequestPayload,
  ): Promise<CreateUserCommandResponsePayload> {
    return new CreateUserCommandResponsePayload(
      await this.repositoryService.create(data),
    );
  }
}
