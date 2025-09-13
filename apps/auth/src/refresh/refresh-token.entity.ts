import { BaseEntity } from "@bootstrap/repository/base.entity";
import { ObjectId } from "bson";
import { IsJWT, IsMongoId } from "class-validator";

import { Entity, Property } from "@mikro-orm/core";

@Entity({ collection: "refresh_tokens" })
export class RefreshTokenEntity extends BaseEntity {
  @Property()
  @IsMongoId()
  user: ObjectId;

  @Property()
  @IsJWT()
  token: string;
}
