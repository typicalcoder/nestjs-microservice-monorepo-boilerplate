import { Expose } from 'class-transformer';
import { IsOptional, IsPhoneNumber, IsString } from 'class-validator';
import { BaseEntity } from '@bootstrap/repository/base.entity';

import { Entity, Property } from '@mikro-orm/core';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

@Entity({ collection: 'users' })
export class UserEntity extends BaseEntity {
  @ApiProperty()
  @Property()
  @Expose()
  @IsPhoneNumber('RU')
  phone!: string;

  @ApiPropertyOptional()
  @Property({ nullable: true })
  @IsString()
  @Expose()
  @IsOptional()
  name?: string;
}
