import { ObjectId } from "bson";
import { Expose } from "class-transformer";
import { IsOptional } from "class-validator";

import {
  Entity,
  PrimaryKey,
  Property,
  SerializedPrimaryKey,
} from "@mikro-orm/core";
import { ApiProperty } from "@nestjs/swagger";

@Entity({ abstract: true })
export abstract class BaseEntity {
  @PrimaryKey()
  _id!: ObjectId;

  @ApiProperty()
  @SerializedPrimaryKey()
  @Expose()
  id!: string;

  @ApiProperty({ type: Date })
  @Property()
  @Expose()
  createdAt = new Date();

  @Property({ onUpdate: () => new Date(), nullable: true })
  @IsOptional()
  updatedAt: Date;
}
