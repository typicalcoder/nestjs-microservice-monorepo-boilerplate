import { plainToInstance } from 'class-transformer';
import { UserEntity } from '@bootstrap/repository/entities/user.entity';

import { PickType } from '@nestjs/swagger';

export class UserProfileResponseDto extends PickType(UserEntity, [
  'createdAt',
  'name',
  'phone',
  'id',
]) {
  static fromEntity(ent: UserEntity): UserProfileResponseDto {
    return plainToInstance(UserProfileResponseDto, ent, {
      excludeExtraneousValues: true,
    });
  }
}
