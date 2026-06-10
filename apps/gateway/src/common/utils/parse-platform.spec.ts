import { parsePlatformFromUserAgent } from './parse-platform';

describe('parsePlatformFromUserAgent', () => {
  it.each([
    ['Dart/3.11.4 (dart:io; android)', 'android'],
    ['Dart/3.x (dart:io; ios)', 'ios'],
    ['myapp/1.0.2 (Linux; Android 16; arm64-v8a) Dart/3.11.4', 'android'],
    ['myapp/1.0.2 (CFNetwork/1408.0.4 Darwin/22.5.0)', 'ios'],
    ['MyApp/1.0 (iPhone; iPhone OS 17_0 like Mac OS X)', 'ios'],
    ['okhttp/4.12.0 (Linux; Android 14; SM-G998B)', 'android'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/...', null],
    ['curl/8.4.0', null],
    [undefined, null],
    [null, null],
    ['', null],
  ])('UA=%j → %s', (input, expected) => {
    expect(parsePlatformFromUserAgent(input)).toBe(expected);
  });
});
