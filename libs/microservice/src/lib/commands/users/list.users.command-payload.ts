import { UserEntity } from "@bootstrap/repository/entities/user.entity";
import { IsArray, IsObject } from "class-validator";

import { BasePayload } from "@microservice/lib/commands/base.payload";

import { FilterQuery } from "@mikro-orm/core";
import { ApiProperty } from "@nestjs/swagger";

export class ListUserCommandRequestPayload extends BasePayload {
  @IsObject()
  filter: FilterQuery<UserEntity>;

  __internal_type = "ListUserCommandRequestPayload" as const;

  constructor(filter: FilterQuery<UserEntity>) {
    super();

    this.filter = filter;
  }
}

export class ListUserCommandResponsePayload extends BasePayload {
  @ApiProperty()
  @IsArray()
  list!: UserEntity[];

  __internal_type = "ListUserCommandResponsePayload" as const;

  constructor(list: UserEntity[]) {
    super();

    this.list = list;
  }
}
