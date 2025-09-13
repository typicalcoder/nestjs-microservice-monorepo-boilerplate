import { LixRequest } from "@bootstrap/types";
import { MicroservicesEnum } from "@microservice";
import { firstValueFrom } from "rxjs";

import {
  GetUserCommandRequestPayload,
  UsersCommands,
} from "@microservice/lib/commands/users";
import { CustomAmqpProxy } from "@microservice/lib/custom-amqp-proxy";

import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";

@Injectable()
export class HandleUserInterceptor implements NestInterceptor {
  constructor(
    @Inject(MicroservicesEnum.USERS)
    private readonly clientUsers: CustomAmqpProxy<MicroservicesEnum.USERS>,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<any> {
    const request = context.switchToHttp().getRequest<LixRequest>();
    if (request.user) {
      request.user.entity = (
        await firstValueFrom(
          this.clientUsers.message(
            UsersCommands.get,
            new GetUserCommandRequestPayload({ id: request.user.sub }),
          ),
        )
      ).user;
      // const [user, roles] = await Promise.all([
      //   !request.user.entities
      //     ? this.userModel.findOne<User>({
      //         active: true,
      //         _id: new ObjectId(request.user.sub),
      //       })
      //     : request.user.entities,
      //   this.permissionRepository.computeRoles(request.user.sub),
      // ]);
      // request.user.entities = user;
      // if (request.user.entities.permissions) {
      //   request.user.entities.permissions = enrichRoles(
      //     request.user.entities.permissions,
      //   );
      // }
      // request.user.roles = roles;
    }
    return next.handle();
  }
}
