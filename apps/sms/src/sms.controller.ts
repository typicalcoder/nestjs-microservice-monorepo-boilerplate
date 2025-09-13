import {
  SendSmsCommandRequestPayload,
  SendSmsCommandResponsePayload,
  SmsCommands,
} from "@microservice/lib/commands/sms";

import { Controller } from "@nestjs/common";
import { MessagePattern, Payload } from "@nestjs/microservices";

import { SmsService } from "./sms.service";

@Controller()
export class SmsController {
  constructor(private readonly smsService: SmsService) {}

  @MessagePattern(SmsCommands.send)
  async sms(
    @Payload() data: SendSmsCommandRequestPayload,
  ): Promise<SendSmsCommandResponsePayload> {
    return new SendSmsCommandResponsePayload(
      await this.smsService.send(data.phone, data.message),
    );
  }
}
