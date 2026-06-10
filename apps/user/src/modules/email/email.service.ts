import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Transporter } from 'nodemailer';
import * as nodemailer from 'nodemailer';
import { optionalEnv, requireEnv, requireEnvInt } from '@app/common';

/**
 * Outbound email via SMTP — the single supported transport. We lean on
 * SMTP intentionally: every provider on our shortlist (Unisender, Mailgun,
 * SES, self-hosted Postfix) speaks it, so we avoid per-vendor SDKs and
 * stay portable across stages.
 *
 * Behaviour contract:
 *   - `send()` never throws on dispatch failure — `/forgot` must not leak
 *     the existence of an email address via error response.
 *   - In dev (no `SMTP_HOST` configured) we log the message instead of
 *     trying to open a connection; so local flows work end-to-end without
 *     an SMTP server running.
 *   - Single shared Transporter (pooled) lives for the process lifetime
 *     and is closed on shutdown.
 */
@Injectable()
export class EmailService implements OnModuleDestroy {
  private readonly logger = new Logger(EmailService.name);
  private readonly fromAddr = optionalEnv('EMAIL_FROM', 'noreply@example.com');
  private readonly transporter: Transporter | null;
  private readonly usingStub: boolean;

  constructor() {
    const host = optionalEnv('SMTP_HOST', '');
    if (!host) {
      this.transporter = null;
      this.usingStub = true;
      this.logger.log(
        'SMTP_HOST not set — EmailService running in stub mode (logs only)',
      );
      return;
    }
    const port = requireEnvInt('SMTP_PORT', { min: 1, max: 65535 });
    // STARTTLS is the common case on 587; implicit TLS on 465. Default
    // `secure` by port, allow override via SMTP_SECURE=true|false.
    const secureOverride = optionalEnv('SMTP_SECURE', '').toLowerCase();
    const secure =
      secureOverride === 'true'
        ? true
        : secureOverride === 'false'
          ? false
          : port === 465;
    const user = optionalEnv('SMTP_USER', '');
    const pass = user ? requireEnv('SMTP_PASSWORD') : '';

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      pool: true,
      maxConnections: 3,
      auth: user ? { user, pass } : undefined,
    });
    this.usingStub = false;
  }

  onModuleDestroy(): void {
    if (this.transporter) {
      this.transporter.close();
    }
  }

  async send(msg: {
    to: string;
    subject: string;
    bodyText: string;
    tag?: string;
  }): Promise<void> {
    if (this.usingStub || !this.transporter) {
      this.logger.log(
        `[STUB EMAIL] to=${msg.to} from=${this.fromAddr} tag=${msg.tag ?? '-'} subject="${msg.subject}"`,
      );
      this.logger.debug(`[STUB EMAIL BODY] ${msg.bodyText}`);
      return;
    }
    try {
      await this.transporter.sendMail({
        from: this.fromAddr,
        to: msg.to,
        subject: msg.subject,
        text: msg.bodyText,
        headers: msg.tag ? { 'X-App-Tag': msg.tag } : undefined,
      });
    } catch (err) {
      // Caller relies on do-not-reveal semantics; log and swallow.
      this.logger.warn(
        `SMTP dispatch failed to=${msg.to} tag=${msg.tag ?? '-'}: ${(err as Error).message}`,
      );
    }
  }

  async sendPasswordReset(to: string, token: string): Promise<void> {
    // Token is transported plaintext here once; server only stores the hash.
    const resetBaseUrl = optionalEnv(
      'PASSWORD_RESET_URL',
      'https://example.com/reset',
    );
    const body =
      `To reset your password, follow this link:\n\n` +
      `${resetBaseUrl}?token=${encodeURIComponent(token)}\n\n` +
      `The link is valid for one hour. If you didn't request this, ignore this email.`;
    await this.send({
      to,
      subject: 'Password reset',
      bodyText: body,
      tag: 'password_reset',
    });
  }
}
