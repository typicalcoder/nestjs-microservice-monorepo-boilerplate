import { UserEntity } from "@bootstrap/repository/entities/user.entity";
import { Type } from "class-transformer";
import {
  IsMongoId,
  IsOptional,
  IsPhoneNumber,
  ValidateNested,
} from "class-validator";

import { BasePayload } from "@microservice/lib/commands/base.payload";

import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class GetUserCommandRequestPayload extends BasePayload {
  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  id?: string;

  @ApiPropertyOptional()
  @IsPhoneNumber()
  @IsOptional()
  phone?: string;

  __internal_type = "GetUserCommandRequestPayload" as const;

  constructor(dto: { id?: string; phone?: string }) {
    super();

    Object.assign(this, dto);
  }
}

export class GetUserCommandResponsePayload extends BasePayload {
  @ApiProperty()
  @Type(() => UserEntity)
  @ValidateNested()
  user!: UserEntity;

  __internal_type = "GetUserCommandResponsePayload" as const;

  constructor(entity: UserEntity) {
    super();

    this.user = entity;
  }
}
