import { UserCreatedEventPayload } from "./user-created.event-payload";

export * from "./user-created.event-payload";

export enum AuthEvents {
  created = "auth.userCreated",
  updated = "auth.userUpdated",
  deleted = "auth.userDeleted",
}

export type UserEventPayload<T extends AuthEvents> =
  T extends AuthEvents.created ? UserCreatedEventPayload : never;
