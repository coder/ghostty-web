import { describe, expect, test } from 'bun:test';
import {
  createAuthConfig,
  generateSessionToken,
  validateTokenRequest,
  validateWebSocketRequest,
} from '../demo/bin/auth.js';

const TOKEN = '0123456789abcdef0123456789abcdef';

function testConfig(options = {}) {
  return createAuthConfig({ env: {}, token: TOKEN, ...options });
}

describe('demo auth helper', () => {
  test('generates non-empty unique session tokens', () => {
    const first = generateSessionToken();
    const second = generateSessionToken();

    expect(first.length).toBeGreaterThanOrEqual(32);
    expect(second.length).toBeGreaterThanOrEqual(32);
    expect(first).not.toBe(second);
  });

  test('accepts valid loopback host, matching origin, and token for websocket', () => {
    const result = validateWebSocketRequest(testConfig(), {
      host: '127.0.0.1:8080',
      origin: 'http://127.0.0.1:8080',
      token: TOKEN,
    });

    expect(result.ok).toBe(true);
  });

  test('rejects missing websocket token', () => {
    const result = validateWebSocketRequest(testConfig(), {
      host: 'localhost:8080',
      origin: 'http://localhost:8080',
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });

  test('rejects invalid websocket token', () => {
    const result = validateWebSocketRequest(testConfig(), {
      host: 'localhost:8080',
      origin: 'http://localhost:8080',
      token: 'invalid-token',
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });

  test('rejects different-length tokens without throwing', () => {
    expect(() =>
      validateWebSocketRequest(testConfig(), {
        host: 'localhost:8080',
        origin: 'http://localhost:8080',
        token: 'short',
      })
    ).not.toThrow();

    const result = validateWebSocketRequest(testConfig(), {
      host: 'localhost:8080',
      origin: 'http://localhost:8080',
      token: 'short',
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });

  test('rejects foreign websocket origin even with a valid token', () => {
    const result = validateWebSocketRequest(testConfig(), {
      host: '127.0.0.1:8080',
      origin: 'https://evil.example',
      token: TOKEN,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  test('rejects missing websocket origin', () => {
    const result = validateWebSocketRequest(testConfig(), {
      host: '127.0.0.1:8080',
      token: TOKEN,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  test('rejects malformed websocket origin', () => {
    const result = validateWebSocketRequest(testConfig(), {
      host: '127.0.0.1:8080',
      origin: 'not an origin',
      token: TOKEN,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });

  test('rejects missing hosts for token and websocket requests', () => {
    const tokenResult = validateTokenRequest(testConfig(), {});
    const wsResult = validateWebSocketRequest(testConfig(), {
      origin: 'http://127.0.0.1:8080',
      token: TOKEN,
    });

    expect(tokenResult.ok).toBe(false);
    expect(tokenResult.status).toBe(400);
    expect(wsResult.ok).toBe(false);
    expect(wsResult.status).toBe(400);
  });

  test('rejects malformed hosts for token and websocket requests', () => {
    const tokenResult = validateTokenRequest(testConfig(), { host: 'bad host:8080' });
    const wsResult = validateWebSocketRequest(testConfig(), {
      host: 'bad host:8080',
      origin: 'http://bad host:8080',
      token: TOKEN,
    });

    expect(tokenResult.ok).toBe(false);
    expect(tokenResult.status).toBe(400);
    expect(wsResult.ok).toBe(false);
    expect(wsResult.status).toBe(400);
  });

  test('rejects unallowed hosts for token and websocket requests', () => {
    const tokenResult = validateTokenRequest(testConfig(), { host: 'evil.example:8080' });
    const wsResult = validateWebSocketRequest(testConfig(), {
      host: 'evil.example:8080',
      origin: 'http://evil.example:8080',
      token: TOKEN,
    });

    expect(tokenResult.ok).toBe(false);
    expect(tokenResult.status).toBe(403);
    expect(wsResult.ok).toBe(false);
    expect(wsResult.status).toBe(403);
  });

  test('allows token requests from an allowed host with no origin', () => {
    const result = validateTokenRequest(testConfig(), { host: 'localhost:8080' });

    expect(result.ok).toBe(true);
  });

  test('rejects token requests with a foreign origin', () => {
    const result = validateTokenRequest(testConfig(), {
      host: 'localhost:8080',
      origin: 'http://evil.example:8080',
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  test('allows extra hosts only when explicitly configured', () => {
    const defaultResult = validateTokenRequest(testConfig(), { host: 'demo.example:8080' });
    const configured = testConfig({ allowedHosts: ['demo.example'] });
    const tokenResult = validateTokenRequest(configured, { host: 'demo.example:8080' });
    const wsResult = validateWebSocketRequest(configured, {
      host: 'demo.example:8080',
      origin: 'http://demo.example:8080',
      token: TOKEN,
    });

    expect(defaultResult.ok).toBe(false);
    expect(defaultResult.status).toBe(403);
    expect(tokenResult.ok).toBe(true);
    expect(wsResult.ok).toBe(true);
  });

  test('allows hosts configured through GHOSTTY_ALLOWED_HOSTS when using a wildcard bind', () => {
    const wildcard = testConfig({ env: { HOST: '0.0.0.0' } });
    const configured = testConfig({
      env: { HOST: '0.0.0.0', GHOSTTY_ALLOWED_HOSTS: 'demo.example' },
    });

    expect(validateTokenRequest(wildcard, { host: 'demo.example:8080' }).ok).toBe(false);
    expect(validateTokenRequest(configured, { host: 'demo.example:8080' }).ok).toBe(true);
  });

  test('allows a concrete HOST bind value as an allowed host', () => {
    const configured = testConfig({ env: { HOST: 'demo.local' } });

    const result = validateWebSocketRequest(configured, {
      host: 'demo.local:8080',
      origin: 'http://demo.local:8080',
      token: TOKEN,
    });

    expect(result.ok).toBe(true);
  });
});
