import { CurrentUser, CurrentUserId } from "@bootstrap/decorators";
import { RequestUserInfo } from "@bootstrap/types";

import { Controller, Get, Param } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
} from "@nestjs/swagger";

import { UserProfileResponseDto } from "./dto/user-profile.response.dto";
import { UserService } from "./user.service";

@ApiBearerAuth()
@Controller("user")
export class UserController {
  constructor(private readonly userService: UserService) {}

  @ApiOperation({
    summary: "Получить информацию о текущем пользователе",
  })
  @ApiOkResponse({
    type: UserProfileResponseDto,
  })
  @Get()
  me(@CurrentUserId() userId: string): any {
    return this.userService.get(userId);
  }

  @ApiOperation({
    summary: "Получить информацию о пользователе по ID",
  })
  @ApiOkResponse({
    type: UserProfileResponseDto,
  })
  @ApiParam({
    name: "id",
    required: true,
    description: "Идентификатор пользователя",
  })
  @Get(":id")
  get(
    @CurrentUser() reqUser: RequestUserInfo,
    @Param("id") userId: string,
  ): any {
    return this.userService.get(userId);
  }
}
