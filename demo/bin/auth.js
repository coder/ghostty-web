import assert from 'assert';
import { randomBytes, timingSafeEqual } from 'crypto';
import { isIP } from 'net';

const LOOPBACK_HOSTS = Object.freeze(['localhost', '127.0.0.1', '::1']);
const WILDCARD_BIND_HOSTS = Object.freeze(['0.0.0.0', '::', '*']);

function decision(status, reason) {
  return { ok: false, status, reason };
}

function badRequest() {
  return decision(400, 'Bad Request');
}

function forbidden() {
  return decision(403, 'Forbidden');
}

function unauthorized() {
  return decision(401, 'Unauthorized');
}

function parseAllowedHosts(value) {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((host) => host.trim())
    .filter((host) => host.length > 0);
}

function normalizeHostname(hostname) {
  if (typeof hostname !== 'string') {
    return null;
  }

  let value = hostname.trim().toLowerCase();
  if (value.length === 0 || /\s/.test(value)) {
    return null;
  }

  if (value.startsWith('[') || value.endsWith(']')) {
    if (!value.startsWith('[') || !value.endsWith(']')) {
      return null;
    }
    value = value.slice(1, -1);
  }

  if (value.length === 0 || value.includes('/') || value.includes('\\') || value.includes('@')) {
    return null;
  }

  if (isIP(value) !== 0) {
    return value;
  }

  if (value.includes(':') || !/^[a-z0-9.-]+$/.test(value)) {
    return null;
  }

  const labels = value.split('.');
  if (labels.some((label) => label.length === 0 || label.length > 63)) {
    return null;
  }

  for (const label of labels) {
    if (label.startsWith('-') || label.endsWith('-')) {
      return null;
    }
  }

  return value;
}

function addAllowedHost(allowedHosts, host) {
  const normalized = normalizeHostname(host);
  assert(normalized, `Allowed host must be a hostname or IP address: ${host}`);
  allowedHosts.add(normalized);
}

function parsePort(port) {
  if (port === undefined || port === '') {
    return '';
  }
  if (!/^[0-9]+$/.test(port)) {
    return null;
  }
  const value = Number.parseInt(port, 10);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    return null;
  }
  return String(value);
}

export function parseHostHeader(hostHeader) {
  if (
    typeof hostHeader !== 'string' ||
    hostHeader.length === 0 ||
    hostHeader.trim() !== hostHeader
  ) {
    return null;
  }

  let hostname = '';
  let port = '';

  if (hostHeader.startsWith('[')) {
    const match = /^\[([^\]]+)\](?::([0-9]+))?$/.exec(hostHeader);
    if (!match) {
      return null;
    }
    hostname = match[1];
    const parsedPort = parsePort(match[2]);
    if (parsedPort === null) {
      return null;
    }
    port = parsedPort;
  } else {
    const colonCount = (hostHeader.match(/:/g) || []).length;
    if (colonCount === 0) {
      hostname = hostHeader;
    } else if (colonCount === 1) {
      const parts = hostHeader.split(':');
      hostname = parts[0];
      const parsedPort = parsePort(parts[1]);
      if (parsedPort === null) {
        return null;
      }
      port = parsedPort;
    } else {
      hostname = hostHeader;
    }
  }

  const normalizedHostname = normalizeHostname(hostname);
  if (!normalizedHostname) {
    return null;
  }

  return { hostname: normalizedHostname, port };
}

function parseOriginHeader(originHeader) {
  if (
    typeof originHeader !== 'string' ||
    originHeader.length === 0 ||
    originHeader.trim() !== originHeader
  ) {
    return null;
  }

  let origin;
  try {
    origin = new URL(originHeader);
  } catch (_error) {
    return null;
  }

  if (origin.protocol !== 'http:' && origin.protocol !== 'https:') {
    return null;
  }

  if (
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  ) {
    return null;
  }

  const host = parseHostHeader(origin.host);
  if (!host) {
    return null;
  }

  return { protocol: origin.protocol, ...host };
}

function defaultPort(protocol) {
  assert(protocol === 'http:' || protocol === 'https:', `Unexpected origin protocol: ${protocol}`);
  return protocol === 'https:' ? '443' : '80';
}

function originMatchesHost(origin, host) {
  const fallbackPort = defaultPort(origin.protocol);
  return (
    origin.hostname === host.hostname &&
    (origin.port || fallbackPort) === (host.port || fallbackPort)
  );
}

function validateAllowedHost(config, hostHeader) {
  assertAuthConfig(config);
  const host = parseHostHeader(hostHeader);
  if (!host) {
    return { ...badRequest(), host: null };
  }

  if (!config.allowedHosts.includes(host.hostname)) {
    return { ...forbidden(), host };
  }

  return { ok: true, host };
}

function validateMatchingOrigin(originHeader, host, required) {
  if (originHeader === undefined && !required) {
    return { ok: true };
  }

  if (originHeader === undefined) {
    return forbidden();
  }

  const origin = parseOriginHeader(originHeader);
  if (!origin) {
    return badRequest();
  }

  if (!originMatchesHost(origin, host)) {
    return forbidden();
  }

  return { ok: true };
}

function safeTokenEquals(expected, actual) {
  assert(
    typeof expected === 'string' && expected.length > 0,
    'Expected auth token must be non-empty'
  );
  if (typeof actual !== 'string' || actual.length === 0) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected, 'utf8');
  const actualBuffer = Buffer.from(actual, 'utf8');
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}

function assertAuthConfig(config) {
  assert(config && typeof config === 'object', 'Auth config must be an object');
  assert(
    typeof config.token === 'string' && config.token.length > 0,
    'Auth token must be non-empty'
  );
  assert(
    Array.isArray(config.allowedHosts) && config.allowedHosts.length > 0,
    'Allowed host list must be non-empty'
  );
}

export function generateSessionToken() {
  const token = randomBytes(32).toString('base64url');
  assert(token.length >= 32, 'Generated session token must contain enough entropy');
  return token;
}

export function isWildcardBindHost(host) {
  const normalized = normalizeHostname(host);
  return (
    WILDCARD_BIND_HOSTS.includes(host) ||
    (normalized !== null && WILDCARD_BIND_HOSTS.includes(normalized))
  );
}

export function isLoopbackHost(host) {
  const normalized = normalizeHostname(host);
  return normalized !== null && LOOPBACK_HOSTS.includes(normalized);
}

export function createAuthConfig(options = {}) {
  const env = options.env ?? process.env;
  const bindHost = options.bindHost ?? env.HOST ?? '127.0.0.1';
  const token = options.token ?? generateSessionToken();

  assert(typeof bindHost === 'string' && bindHost.length > 0, 'Bind host must be non-empty');
  assert(typeof token === 'string' && token.length > 0, 'Auth token must be non-empty');
  assert(LOOPBACK_HOSTS.length > 0, 'Loopback host allowlist must not be empty');

  const allowedHosts = new Set(LOOPBACK_HOSTS);
  for (const host of options.allowedHosts ?? parseAllowedHosts(env.GHOSTTY_ALLOWED_HOSTS)) {
    addAllowedHost(allowedHosts, host);
  }

  if (!isWildcardBindHost(bindHost)) {
    addAllowedHost(allowedHosts, bindHost);
  }

  return Object.freeze({
    token,
    bindHost,
    allowedHosts: Object.freeze([...allowedHosts]),
  });
}

export function validateTokenRequest(config, request) {
  const hostDecision = validateAllowedHost(config, request.host);
  if (!hostDecision.ok) {
    return hostDecision;
  }

  const originDecision = validateMatchingOrigin(request.origin, hostDecision.host, false);
  if (!originDecision.ok) {
    return originDecision;
  }

  return { ok: true };
}

export function validateWebSocketRequest(config, request) {
  const hostDecision = validateAllowedHost(config, request.host);
  if (!hostDecision.ok) {
    return hostDecision;
  }

  const originDecision = validateMatchingOrigin(request.origin, hostDecision.host, true);
  if (!originDecision.ok) {
    return originDecision;
  }

  if (!safeTokenEquals(config.token, request.token)) {
    return unauthorized();
  }

  return { ok: true };
}
