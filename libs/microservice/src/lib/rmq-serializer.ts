import { MicroservicesEnum } from '@bootstrap';

import { Commands } from '@microservice/lib/commands';

import { Serializer } from '@nestjs/microservices/interfaces/serializer.interface';

export class RmqSerializer<T extends MicroservicesEnum, U extends Commands[T]>
  implements Serializer
{
  serialize(value: any, options?: Record<string, any>): any {
    return value;
  }
}
