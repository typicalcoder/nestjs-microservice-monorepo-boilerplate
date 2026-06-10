import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Ready-made query DTO for cursor-paginated list endpoints. Not used by the
 * skeleton itself — wire it into your list endpoints:
 *
 *   @Get('items')
 *   list(@CurrentUser() u: { userId: string }, @Query() page: PaginationDto) {
 *     return this.rpc.user(MSG.LIST_ITEMS, { userId: u.userId, ...page });
 *   }
 *
 * The service side treats `cursor` as the last seen Mongo ObjectId and
 * filters `_id < cursor` ordered by `_id desc` (stable, index-friendly).
 */
export class PaginationDto {
  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 50;

  @ApiPropertyOptional({ description: 'Opaque cursor (MongoDB ObjectId)' })
  @IsOptional()
  @IsString()
  cursor?: string;
}
