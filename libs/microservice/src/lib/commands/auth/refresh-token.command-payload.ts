import { Expose } from "class-transformer";
import { IsJWT, IsString } from "class-validator";

import { BasePayload } from "@microservice/lib/commands/base.payload";

import { ApiProperty } from "@nestjs/swagger";

export class RefreshTokenCommandRequestPayload extends BasePayload {
  @IsString()
  @Expose()
  refresh_token: string;

  @IsString()
  @Expose()
  userId: string;

  __internal_type = "RefreshTokenCommandRequestPayload" as const;

  constructor(refresh_token: string, userId: string) {
    super();

    this.refresh_token = refresh_token;
    this.userId = userId;
  }
}

export class RefreshTokenCommandResponsePayload extends BasePayload {
  @ApiProperty({
    description: "JWT access token",
  })
  @IsJWT()
  @Expose()
  access_token: string;

  @ApiProperty({
    description: "JWT refresh token",
  })
  @IsString()
  @Expose()
  refresh_token: string;

  __internal_type = "RefreshTokenCommandResponsePayload" as const;

  constructor(access_token: string, refresh_token: string) {
    super();

    this.access_token = access_token;
    this.refresh_token = refresh_token;
  }
}
