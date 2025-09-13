import { IsMongoId } from "class-validator";

export class UserCreatedEventPayload {
  @IsMongoId()
  id: string;

  constructor(id: string) {
    this.id = id;
  }
}
