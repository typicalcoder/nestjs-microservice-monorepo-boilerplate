import { MicroservicesEnum } from '@microservice';
import { Observable } from 'rxjs';
import { getAsyncStorage } from '@bootstrap/logger/asyncStorage';

import { CommandPayload, Commands } from '@microservice/lib/commands';

import { ClientRMQ } from '@nestjs/microservices';
import { RmqOptions } from '@nestjs/microservices/interfaces';

export class CustomAmqpProxy<T extends MicroservicesEnum> extends ClientRMQ {
  constructor(options: Required<RmqOptions>['options']) {
    super(options);
  }

  message<U extends Commands[T]>(
    command: U,
    payload: CommandPayload<T, U, 'req'>,
  ): Observable<CommandPayload<T, U, 'resp'>> {
    payload.__traceId = payload.__traceId ?? getAsyncStorage()?.traceId;
    return this.send(command, payload);
  }

  event<U extends Commands[T]>(
    command: U,
    payload: CommandPayload<T, U, 'req'>,
  ): Observable<CommandPayload<T, U, 'resp'>> {
    payload.__traceId = payload.__traceId ?? getAsyncStorage()?.traceId;
    return this.emit(command, payload);
  }
}
