import {
  SendSmsCommandRequestPayload,
  SendSmsCommandResponsePayload,
} from '@microservice/lib/commands/sms/send.sms.command-payload';

export * from './send.sms.command-payload';

export enum SmsCommands {
  send = 'sms.send',
}

export type SmsCommandPayload<T extends SmsCommands> =
  T extends SmsCommands.send
    ? {
        req: SendSmsCommandRequestPayload;
        resp: SendSmsCommandResponsePayload;
      }
    : never;

export const SmsCommandTypeMap = {
  SendSmsCommandRequestPayload: SendSmsCommandRequestPayload,
  SendSmsCommandResponsePayload: SendSmsCommandResponsePayload,
};
