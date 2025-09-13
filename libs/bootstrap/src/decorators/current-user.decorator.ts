import {
  JwtPayloadWithRt,
  LixRequest,
  RequestUserInfo,
} from "@bootstrap/types";

import { createParamDecorator, ExecutionContext } from "@nestjs/common";

export const CurrentUser = createParamDecorator(
  (
    data: keyof JwtPayloadWithRt | undefined,
    context: ExecutionContext,
  ): RequestUserInfo => {
    const request = context.switchToHttp().getRequest<LixRequest>();
    if (!data) {
      return request.user;
    }
    return request.user[data] as unknown as RequestUserInfo;
  },
);
