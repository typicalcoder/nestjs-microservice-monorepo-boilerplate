import { Expose, Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Max,
  Min,
} from 'class-validator';

import { BasePayload } from '@microservice/lib/commands/base.payload';

import { ApiProperty } from '@nestjs/swagger';

export class RequestCodeCommandRequestPayload extends BasePayload {
  @ApiProperty({
    description: 'Номер телефона для авторизации',
  })
  @IsPhoneNumber('RU', { message: 'Номер телефона должен быть валидным' })
  @Transform(({ value }: { value: string }) => value.replaceAll(/\D/g, ''))
  @Expose()
  phone: string;

  @ApiProperty({
    description: 'Токен капчи',
  })
  @IsString()
  @Expose()
  token: string;

  @IsString()
  @IsOptional()
  @Expose()
  ip?: string;

  __internal_type = 'RequestCodeCommandRequestPayload' as const;

  constructor(phone: string, token: string, ip?: string) {
    super();

    this.phone = phone;
    this.token = token;
    this.ip = ip;
  }
}

export class RequestCodeCommandResponsePayload extends BasePayload {
  @ApiProperty({
    description: 'Статус отправки кода',
  })
  @IsInt()
  @Min(0)
  @Max(1)
  status: number;

  __internal_type = 'RequestCodeCommandResponsePayload' as const;

  constructor(status: number) {
    super();

    this.status = status;
  }
}
