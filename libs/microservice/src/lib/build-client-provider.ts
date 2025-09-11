import { MicroservicesEnum } from '@microservice';
import { selectConfig } from 'nest-typed-config';
import { BaseConfig, ConfigModuleFactory } from '@bootstrap/base-config';

import { CustomAmqpProxy } from '@microservice/lib/custom-amqp-proxy';
import { RmqDeserializer } from '@microservice/lib/rmq-deserializer';
import { RmqSerializer } from '@microservice/lib/rmq-serializer';

import { Provider } from '@nestjs/common';

export function buildClientProvider(
  service: MicroservicesEnum,
  configSchema: typeof BaseConfig,
): Provider {
  const configModule = ConfigModuleFactory(configSchema);
  const config = selectConfig(configModule, configSchema);
  return {
    provide: service,
    useValue: new CustomAmqpProxy({
      prefetchCount: 10,
      urls: [config.RABBIT_MQ],
      queue: config.getQueueName(service),
      serializer: new RmqSerializer(),
      deserializer: new RmqDeserializer(),
      noAck: true,
      consumerTag: config.POD_NAME,
      queueOptions: {
        durable: false,
      },
    }),
  };
}
