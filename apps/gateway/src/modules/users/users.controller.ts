import { Body, Controller, Delete, Get, Patch } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  MSG,
  RpcClientService,
  SuccessDto,
  UserDto,
} from '@app/common';
import { UpdateUserDto } from './dto/user.dto';

@ApiTags('users')
@ApiBearerAuth()
@Controller('v1')
export class UsersController {
  constructor(private readonly rpc: RpcClientService) {}

  @Get('users/me')
  @ApiOperation({
    summary: 'Get own profile',
    description: 'Returns the authenticated user profile.',
  })
  @ApiOkResponse({ type: UserDto })
  getMe(@CurrentUser() user: { userId: string }) {
    return this.rpc.user<UserDto>(MSG.GET_USER_BY_ID, { userId: user.userId });
  }

  @Patch('users/me')
  @ApiOperation({
    summary: 'Update own profile',
    description: 'Partial update — only provided fields are changed.',
  })
  @ApiBody({ type: UpdateUserDto })
  @ApiOkResponse({ type: UserDto })
  updateMe(
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateUserDto,
  ) {
    return this.rpc.user<UserDto>(MSG.UPDATE_USER, {
      userId: user.userId,
      ...dto,
    });
  }

  @Delete('users/me')
  @ApiOperation({
    summary: 'Delete account',
    description:
      'Soft-deletes the account. Data is purged after the grace window by the user-purge task.',
  })
  @ApiOkResponse({ type: SuccessDto })
  deleteMe(@CurrentUser() user: { userId: string }) {
    return this.rpc.user<SuccessDto>(MSG.DELETE_USER, { userId: user.userId });
  }
}
