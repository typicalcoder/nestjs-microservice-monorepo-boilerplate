import {
  AuthenticateCommandRequestPayload,
  AuthenticateCommandResponsePayload,
  RefreshTokenCommandResponsePayload,
} from '@microservice';
import { Observable } from 'rxjs';
import { CurrentUser, CurrentUserId, Public } from '@bootstrap/decorators';
import { RtGuard } from '@bootstrap/guards';

import {
  RequestCodeCommandRequestPayload,
  RequestCodeCommandResponsePayload,
} from '@microservice/lib/commands/auth/request-code.command-payload';

import { Body, Controller, Headers, Ip, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOperation,
  getSchemaPath,
} from '@nestjs/swagger';

import { AuthService } from './auth.service';

@Controller('auth')
@ApiExtraModels(RequestCodeCommandRequestPayload)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({
    requestBody: {
      $ref: getSchemaPath(RequestCodeCommandRequestPayload),
    },
    summary: 'Запрос кода авторизации',
  })
  @Public()
  @Post('code')
  requestCode(
    @Body() dto: RequestCodeCommandRequestPayload,
    @Ip() ipDirect: string,
    @Headers('CF-Connecting-IP') ipCf?: string,
  ): Observable<RequestCodeCommandResponsePayload> {
    dto.ip = ipCf ?? ipDirect;
    return this.authService.code(dto);
  }

  @ApiOperation({
    requestBody: {
      $ref: getSchemaPath(AuthenticateCommandRequestPayload),
    },
    summary: 'Авторизация',
  })
  @Public()
  @Post('auth')
  auth(
    @Body() dto: AuthenticateCommandRequestPayload,
    //@Ip() ipDirect: string,
    //@Headers('CF-Connecting-IP') ipCf?: string,
  ): Observable<AuthenticateCommandResponsePayload> {
    //dto.ip = ipCf ?? ipDirect;
    return this.authService.auth(dto);
  }

  @ApiOperation({
    summary: 'Обновление JWT',
  })
  @Public()
  @Post('refresh')
  @UseGuards(RtGuard)
  @ApiBearerAuth()
  @ApiCreatedResponse({
    type: AuthenticateCommandResponsePayload,
  })
  refresh(
    @CurrentUserId() userId: string,
    @CurrentUser('refreshToken') refreshToken: string,
  ): Observable<RefreshTokenCommandResponsePayload> {
    return this.authService.refresh(userId, refreshToken);
  }
}
