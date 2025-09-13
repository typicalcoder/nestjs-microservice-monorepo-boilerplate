import { Expose, Transform } from "class-transformer";
import {
  IsJWT,
  IsPhoneNumber,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

import { BasePayload } from "@microservice/lib/commands/base.payload";

import { ApiProperty } from "@nestjs/swagger";

export class AuthenticateCommandRequestPayload extends BasePayload {
  @ApiProperty({
    description: "Номер телефона для авторизации",
  })
  @IsPhoneNumber("RU")
  @Transform(({ value }: { value: string }) => value.replaceAll(/\D/g, ""))
  @Expose()
  phone: string;

  @ApiProperty({
    description: "Код из СМС",
  })
  @IsString()
  @MinLength(4)
  @MaxLength(4)
  @Expose()
  code: string;

  __internal_type = "AuthenticateCommandRequestPayload" as const;

  constructor(phone: string, code: string) {
    super();

    this.phone = phone;
    this.code = code;
  }
}

export class AuthenticateCommandResponsePayload extends BasePayload {
  @ApiProperty({
    description: "JWT access token",
  })
  @IsJWT()
  @Expose()
  access_token: string;

  @ApiProperty({
    description: "JWT refresh token",
  })
  @IsJWT()
  @Expose()
  refresh_token: string;

  __internal_type = "AuthenticateCommandResponsePayload" as const;

  constructor(access_token: string, refresh_token: string) {
    super();

    this.access_token = access_token;
    this.refresh_token = refresh_token;
  }
}
