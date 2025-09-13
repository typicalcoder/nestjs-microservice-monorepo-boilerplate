import { CustomDecorator, SetMetadata } from "@nestjs/common";

export const SkipAtGuard = (): CustomDecorator<string> =>
  SetMetadata("skipAtGuard", true);
