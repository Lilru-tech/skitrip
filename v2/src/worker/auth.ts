import { createRemoteJWKSet, decodeJwt, decodeProtectedHeader, errors as joseErrors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import type { AuthInfo } from './env';

// Claves públicas oficiales de Firebase Auth (ID tokens). jose las cachea en el isolate
// y respeta un cooldown antes de volver a pedirlas cuando aparece un `kid` desconocido.
export const FIREBASE_JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let remoteKeys: JWTVerifyGetKey | null = null;
function firebaseKeys(): JWTVerifyGetKey {
  remoteKeys ??= createRemoteJWKSet(new URL(FIREBASE_JWKS_URL), { cacheMaxAge: 6 * 3600_000, cooldownDuration: 60_000 });
  return remoteKeys;
}

export class AuthError extends Error {
  constructor(public code: 'missing' | 'invalid' | 'expired' | 'emulator_not_allowed') {
    super(code);
  }
}

export interface VerifyOptions {
  projectId: string;
  mode: 'firebase' | 'emulator';
  requestHost: string;
  keys?: JWTVerifyGetKey; // inyectable en pruebas
  nowSeconds?: number;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const CLOCK_TOLERANCE_S = 5;

function checkCommonClaims(p: JWTPayload & { auth_time?: unknown; email?: unknown }, opts: VerifyOptions): AuthInfo {
  const nowS = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (p.iss !== `https://securetoken.google.com/${opts.projectId}`) throw new AuthError('invalid');
  const aud = Array.isArray(p.aud) ? p.aud : [p.aud];
  if (aud.length !== 1 || aud[0] !== opts.projectId) throw new AuthError('invalid');
  if (typeof p.sub !== 'string' || p.sub.length === 0 || p.sub.length > 128) throw new AuthError('invalid');
  if (typeof p.exp !== 'number' || p.exp + CLOCK_TOLERANCE_S <= nowS) throw new AuthError('expired');
  if (typeof p.iat !== 'number' || p.iat - CLOCK_TOLERANCE_S > nowS) throw new AuthError('invalid');
  if (typeof p.auth_time !== 'number' || p.auth_time - CLOCK_TOLERANCE_S > nowS) throw new AuthError('invalid');
  return { uid: p.sub, email: typeof p.email === 'string' ? p.email : null, authTime: p.auth_time };
}

/**
 * Verifica un ID token de Firebase según https://firebase.google.com/docs/auth/admin/verify-id-tokens
 * (RS256, kid de las claves oficiales, iss/aud del proyecto, exp/iat/auth_time, sub no vacío).
 * El modo emulador acepta tokens sin firma del emulador oficial SOLO en hosts locales.
 */
export async function verifyIdToken(token: string | undefined, opts: VerifyOptions): Promise<AuthInfo> {
  if (!token) throw new AuthError('missing');
  if (token.length > 4096) throw new AuthError('invalid');

  if (opts.mode === 'emulator') {
    if (!LOCAL_HOSTS.has(opts.requestHost)) throw new AuthError('emulator_not_allowed');
    let header, payload;
    try {
      header = decodeProtectedHeader(token);
      payload = decodeJwt(token);
    } catch {
      throw new AuthError('invalid');
    }
    if (header.alg !== 'none') throw new AuthError('invalid');
    return checkCommonClaims(payload, opts);
  }

  let header;
  try {
    header = decodeProtectedHeader(token);
  } catch {
    throw new AuthError('invalid');
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new AuthError('invalid');
  try {
    const { payload } = await jwtVerify(token, opts.keys ?? firebaseKeys(), {
      algorithms: ['RS256'],
      issuer: `https://securetoken.google.com/${opts.projectId}`,
      audience: opts.projectId,
      clockTolerance: CLOCK_TOLERANCE_S,
      currentDate: opts.nowSeconds ? new Date(opts.nowSeconds * 1000) : undefined,
    });
    return checkCommonClaims(payload, opts);
  } catch (e) {
    if (e instanceof AuthError) throw e;
    if (e instanceof joseErrors.JWTExpired) throw new AuthError('expired');
    throw new AuthError('invalid');
  }
}

export function bearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const m = /^Bearer ([A-Za-z0-9._-]+)$/.exec(header.trim());
  return m?.[1];
}
