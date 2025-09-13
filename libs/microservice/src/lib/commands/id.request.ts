import { ApiProperty } from "@nestjs/swagger";

export class IdRequest {
  @ApiProperty()
  id: string;
}
