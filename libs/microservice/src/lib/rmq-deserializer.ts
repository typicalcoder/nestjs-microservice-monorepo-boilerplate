import { MicroservicesEnum } from '@bootstrap';
import { plainToInstance } from 'class-transformer';
import { LixRpcException } from '@bootstrap/errors';

import { Commands, typeMap } from '@microservice/lib/commands';

import { Deserializer } from '@nestjs/microservices';

export class RmqDeserializer<T extends MicroservicesEnum, U extends Commands[T]>
  implements Deserializer
{
  deserialize(value: any, options?: Record<string, any>) {
    if (value?.err) {
      return {
        ...value,
        err: LixRpcException.from(value.err),
      };
    }

    if (value?.data?.__internal_type && typeMap[value.data.__internal_type]) {
      return {
        ...value,
        data: plainToInstance(typeMap[value.data.__internal_type], value.data),
      };
    }

    if (
      value?.response?.__internal_type &&
      typeMap[value.response.__internal_type]
    ) {
      const data = plainToInstance(
        typeMap[value.response.__internal_type],
        value.response,
      );

      return {
        ...value,
        response: data,
      };
    }

    return value;
  }
}
