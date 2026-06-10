// ─── Auth ─────────────────────────────────────────────────────────────────────

export enum AccountType {
  /** Anonymous device account created via /auth/autoreg. */
  autoreg = 'autoreg',
  /** Registered account (email/password or linked OAuth identity). */
  user = 'user',
}

export enum Locale {
  ru = 'ru',
  en = 'en',
}

/** OAuth providers supported by the auth flow. */
export enum OAuthProvider {
  google = 'google',
  apple = 'apple',
  vk = 'vk',
  yandex = 'yandex',
}

/** Methods accepted by the account-upgrade endpoint. */
export enum UpgradeMethod {
  email = 'email',
  google = 'google',
  apple = 'apple',
  vk = 'vk',
  yandex = 'yandex',
}

/** Mobile OS reported on autoreg. */
export enum Platform {
  android = 'android',
  ios = 'ios',
}
