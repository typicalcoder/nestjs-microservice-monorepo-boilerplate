import { MicroservicesEnum } from '@bootstrap';
import { firstValueFrom } from 'rxjs';

import {
  GetUserCommandRequestPayload,
  UsersCommands,
} from '@microservice/lib/commands/users';
import { CustomAmqpProxy } from '@microservice/lib/custom-amqp-proxy';

import { Inject, Injectable } from '@nestjs/common';

import { UserProfileResponseDto } from './dto/user-profile.response.dto';

@Injectable()
export class UserService {
  constructor(
    @Inject(MicroservicesEnum.USERS)
    private readonly clientUsers: CustomAmqpProxy<MicroservicesEnum.USERS>,
  ) {}

  async get(id: string): Promise<UserProfileResponseDto> {
    const response = await firstValueFrom(
      this.clientUsers.message(
        UsersCommands.get,
        new GetUserCommandRequestPayload({ id }),
      ),
    );

    return UserProfileResponseDto.fromEntity(response.user);
  }
}
