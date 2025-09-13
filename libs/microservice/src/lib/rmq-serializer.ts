import { Serializer } from "@nestjs/microservices/interfaces/serializer.interface";

export class RmqSerializer implements Serializer {
  serialize(value: any): any {
    return value;
  }
}
