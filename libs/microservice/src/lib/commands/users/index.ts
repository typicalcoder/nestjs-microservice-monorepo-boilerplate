import {
  CreateUserCommandRequestPayload,
  CreateUserCommandResponsePayload,
} from '@microservice/lib/commands/users/create.users.command-payload';
import {
  ListUserCommandRequestPayload,
  ListUserCommandResponsePayload,
} from '@microservice/lib/commands/users/list.users.command-payload';

import {
  GetUserCommandRequestPayload,
  GetUserCommandResponsePayload,
} from './get.users.command-payload';

export * from './get.users.command-payload';
export * from './list.users.command-payload';

export enum UsersCommands {
  get = 'users.get',
  list = 'users.list',
  create = 'users.create',
}

export type UsersCommandPayload<T extends UsersCommands> =
  T extends UsersCommands.get
    ? {
        req: GetUserCommandRequestPayload;
        resp: GetUserCommandResponsePayload;
      }
    : T extends UsersCommands.list
      ? {
          req: ListUserCommandRequestPayload;
          resp: ListUserCommandResponsePayload;
        }
      : T extends UsersCommands.create
        ? {
            req: CreateUserCommandRequestPayload;
            resp: CreateUserCommandResponsePayload;
          }
        : never;

export const UsersCommandTypeMap = {
  GetUserCommandRequestPayload,
  GetUserCommandResponsePayload,
  ListUserCommandRequestPayload,
  ListUserCommandResponsePayload,
  CreateUserCommandRequestPayload,
  CreateUserCommandResponsePayload,
};
