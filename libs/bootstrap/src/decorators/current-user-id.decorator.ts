import { LixRequest } from "@bootstrap/types";

import { createParamDecorator, ExecutionContext } from "@nestjs/common";

export const CurrentUserId = createParamDecorator(
  (_: undefined, context: ExecutionContext): string => {
    const { user } = context.switchToHttp().getRequest<LixRequest>();
    return user.entity.id;
  },
);
