import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service';

// Global so both UsersService and BillingService can inject without wiring.
@Global()
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
