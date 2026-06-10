import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ERROR_CODES } from '@app/common';
import { OAuthProviderId, OAuthVerifier } from './oauth-verifier.interface';
import { VkOAuthVerifierService } from './vk-oauth-verifier.service';
import { YandexOAuthVerifierService } from './yandex-oauth-verifier.service';

/**
 * Maps `:provider` URL param to the right verifier instance. Google /
 * Apple are intentionally not wired (separate ticket); a request
 * for them throws a clean 401 instead of crashing on undefined provider.
 */
@Injectable()
export class OAuthVerifierFactory {
  private readonly verifiers: Partial<Record<OAuthProviderId, OAuthVerifier>>;

  constructor(vk: VkOAuthVerifierService, yandex: YandexOAuthVerifierService) {
    this.verifiers = { vk, yandex };
  }

  for(provider: string): OAuthVerifier {
    const v = this.verifiers[provider as OAuthProviderId];
    if (!v) {
      throw new UnauthorizedException({
        code: ERROR_CODES.TOKEN_INVALID,
        message: `OAuth provider '${provider}' not supported on the server`,
      });
    }
    return v;
  }
}
