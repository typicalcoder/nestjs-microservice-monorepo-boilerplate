import { firstValueFrom } from 'rxjs';
import { getLogger } from '@bootstrap/logger';

import { HttpService } from '@nestjs/axios';
import {
  Injectable,
  InternalServerErrorException,
  OnApplicationBootstrap,
} from '@nestjs/common';

import { Config } from './config';

@Injectable()
export class SmsService implements OnApplicationBootstrap {
  constructor(
    private readonly httpService: HttpService,
    private readonly config: Config,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!(await this.testKey())) {
      getLogger().error('SMS.RU Key invalid');
      throw new InternalServerErrorException('SmsServiceStartFailed');
    }
  }

  async testKey() {
    try {
      const resp = await firstValueFrom(
        this.httpService.get(
          `https://sms.ru/auth/check?api_id=${this.config.SMSRU_API_KEY}&json=1`,
        ),
      );

      return resp?.data?.status === 'OK';
    } catch (error) {}
    return false;
  }

  async getBalance(): Promise<number> {
    try {
      const resp = await firstValueFrom(
        this.httpService.get(
          `https://sms.ru/my/balance?api_id=${this.config.SMSRU_API_KEY}&json=1`,
        ),
      );
      if (resp?.data?.status === 'OK') {
        return resp.data?.balance;
      }
    } catch (error) {}
    return -1;
  }

  async send(phone: string, msg: string, ip?: string): Promise<number> {
    try {
      const resp = await firstValueFrom(
        this.httpService.get(
          `https://sms.ru/sms/send?api_id=${this.config.SMSRU_API_KEY}&to=${phone}&msg=${encodeURIComponent(msg)}&json=1&from=BUDDJET${ip ? '&ip=' + ip : ''}`,
        ),
      );
      if (resp?.data?.status === 'OK') {
        return resp.data?.balance;
      }
    } catch (error) {}
    return -1;
  }
}
