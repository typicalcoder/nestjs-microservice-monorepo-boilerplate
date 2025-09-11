import { Type } from 'class-transformer';
import { IsOptional, IsPhoneNumber, ValidateNested } from 'class-validator';
import { UserEntity } from '@bootstrap/repository/entities/user.entity';

import { BasePayload } from '@microservice/lib/commands/base.payload';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUserCommandRequestPayload extends BasePayload {
  @ApiPropertyOptional()
  @IsPhoneNumber()
  @IsOptional()
  phone?: string;

  __internal_type = 'CreateUserCommandRequestPayload' as const;

  constructor(phone: string) {
    super();

    this.phone = phone;
  }
}

export class CreateUserCommandResponsePayload extends BasePayload {
  @ApiProperty()
  @Type(() => UserEntity)
  @ValidateNested()
  user!: UserEntity;

  __internal_type = 'CreateUserCommandResponsePayload' as const;

  constructor(entity: UserEntity) {
    super();

    this.user = entity;
  }
}
