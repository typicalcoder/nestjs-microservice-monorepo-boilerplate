import { MicroservicesEnum } from "@microservice";

import { CustomAmqpProxy } from "@microservice/lib/custom-amqp-proxy";

import { Inject, Injectable } from "@nestjs/common";

@Injectable()
export class AppService {
  constructor(
    @Inject(MicroservicesEnum.AUTH)
    private readonly clientAuth: CustomAmqpProxy<MicroservicesEnum.AUTH>,
  ) {}
  getHello(): string {
    return "Hello World!";
  }
}
