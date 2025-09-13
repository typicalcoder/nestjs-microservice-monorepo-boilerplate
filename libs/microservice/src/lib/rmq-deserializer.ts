import { LixRpcException } from "@bootstrap/errors";
import { ClassConstructor, plainToInstance } from "class-transformer";
import { isObject, isString } from "class-validator";

import { typeMap } from "@microservice/lib/commands";

import { Logger } from "@nestjs/common";
import { Deserializer } from "@nestjs/microservices/interfaces/deserializer.interface";

export class RmqDeserializer implements Deserializer {
  logger = new Logger(RmqDeserializer.name);

  deserialize(value: unknown): any {
    if (value && isObject(value)) {
      // Проверяем наличие ошибки в значении
      if ("err" in value) {
        return {
          ...value,
          err: LixRpcException.from(value.err),
        };
      }

      // Проверяем наличие данных с внутренним типом
      if (
        "data" in value &&
        isObject(value.data) &&
        "__internal_type" in value.data &&
        isString(value.data.__internal_type) &&
        value.data.__internal_type in typeMap
      ) {
        const data = plainToInstance(
          typeMap[
            value.data.__internal_type as keyof typeof typeMap
          ] as ClassConstructor<unknown>,
          value.data,
        );

        return {
          ...value,
          data: data,
        };
      }

      // Проверяем наличие ответа с внутренним типом
      if (
        "response" in value &&
        isObject(value.response) &&
        "__internal_type" in value.response &&
        isString(value.response.__internal_type) &&
        value.response.__internal_type in typeMap
      ) {
        const data = plainToInstance(
          typeMap[
            value.response.__internal_type as keyof typeof typeMap
          ] as ClassConstructor<unknown>,
          value.response,
        );

        return {
          ...value,
          response: data,
        };
      }
    }

    return value;
  }
}
