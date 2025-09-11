import { MicroservicesEnum } from '@bootstrap';

import { CustomAmqpProxy } from '@microservice/lib/custom-amqp-proxy';

import { Inject, Injectable } from '@nestjs/common';
import { ClientRMQ } from '@nestjs/microservices';

import { AppModule } from '../../auth/src/app.module';

@Injectable()
export class AppService {
  constructor(
    @Inject(MicroservicesEnum.AUTH)
    private readonly clientAuth: CustomAmqpProxy<MicroservicesEnum.AUTH>,
  ) {}
  getHello(): string {
    return 'Hello World!';
  }
}
