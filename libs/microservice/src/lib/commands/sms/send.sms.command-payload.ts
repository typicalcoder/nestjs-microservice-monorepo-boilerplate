import { IsInt, IsPhoneNumber, IsString, Max, Min } from "class-validator";

import { BasePayload } from "@microservice/lib/commands/base.payload";

import { ApiProperty } from "@nestjs/swagger";

export class SendSmsCommandRequestPayload extends BasePayload {
  @ApiProperty()
  @IsPhoneNumber()
  phone: string;

  @ApiProperty()
  @IsString()
  message: string;

  @ApiProperty()
  @IsString()
  ip: string;

  __internal_type = "SendSmsCommandRequestPayload" as const;

  constructor(phone: string, message: string, ip: string) {
    super();

    this.phone = phone;
    this.message = message;
    this.ip = ip;
  }
}

export class SendSmsCommandResponsePayload extends BasePayload {
  @ApiProperty({
    description: "Баланс после отправки кода",
  })
  @IsInt()
  @Min(0)
  @Max(1)
  balance: number;

  __internal_type = "SendSmsCommandResponsePayload" as const;

  constructor(balance: number) {
    super();

    this.balance = balance;
  }
}
