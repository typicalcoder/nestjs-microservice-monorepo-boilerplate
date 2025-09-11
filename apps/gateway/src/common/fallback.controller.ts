import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

@Controller()
@ApiExcludeController()
export class FallbackController {
  @Get()
  fallback(): string {
    return 'Hello, Hacker!';
  }
}
