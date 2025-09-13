import { MicroservicesEnum } from "@microservice";

import {
  AuthCommandPayload,
  AuthCommands,
  AuthCommandTypeMap,
} from "@microservice/lib/commands/auth";
import {
  SmsCommandPayload,
  SmsCommands,
  SmsCommandTypeMap,
} from "@microservice/lib/commands/sms";
import {
  UsersCommandPayload,
  UsersCommands,
  UsersCommandTypeMap,
} from "@microservice/lib/commands/users";

export type Commands = {
  [MicroservicesEnum.AUTH]: AuthCommands;
  [MicroservicesEnum.USERS]: UsersCommands;
  [MicroservicesEnum.CORE]: null;
  [MicroservicesEnum.GATEWAY]: null;
  [MicroservicesEnum.SMS]: SmsCommands;
};

export type CommandPayload<
  U extends MicroservicesEnum,
  T extends Commands[U],
  Dir extends "req" | "resp",
> = T extends AuthCommands
  ? AuthCommandPayload<T>[Dir]
  : T extends UsersCommands
    ? UsersCommandPayload<T>[Dir]
    : T extends SmsCommands
      ? SmsCommandPayload<T>[Dir]
      : never;

export const typeMap = {
  ...AuthCommandTypeMap,
  ...UsersCommandTypeMap,
  ...SmsCommandTypeMap,
};
