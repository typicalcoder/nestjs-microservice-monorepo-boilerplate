import { IsOptional, IsPhoneNumber, IsString } from 'class-validator';
import { BaseDto } from '@bootstrap/repository/base.dto';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UserDto extends BaseDto {
  @ApiProperty()
  @IsPhoneNumber('RU')
  phone!: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  name?: string;
}
