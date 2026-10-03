import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { AuthError, verifyIdToken } from '../../src/worker/auth';

const PROJECT = 'skitrip-prod';
let keys: ReturnType<typeof createLocalJWKSet>;
let priv: CryptoKey;
let otherPriv: CryptoKey;

beforeAll(async () => {
  const kp = await generateKeyPair('RS256', { extractable: true });
  const other = await generateKeyPair('RS256', { extractable: true });
  priv = kp.privateKey;
  otherPriv = other.privateKey;
  const jwk = { ...(await exportJWK(kp.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  keys = createLocalJWKSet({ keys: [jwk] });
});

async function sign(claims: Record<string, unknown> = {}, opts: { key?: CryptoKey; kid?: string; alg?: string } = {}) {
  const nowS = Math.floor(Date.now() / 1000);
  return new SignJWT({ auth_time: nowS, email: 'a@b.test', ...claims })
    .setProtectedHeader({ alg: opts.alg ?? 'RS256', kid: opts.kid ?? 'k1' })
    .setIssuer((claims.iss as string) ?? `https://securetoken.google.com/${PROJECT}`)
    .setAudience((claims.aud as string) ?? PROJECT)
    .setSubject((claims.sub as string) ?? 'uid-1')
    .setIssuedAt((claims.iat as number) ?? nowS)
    .setExpirationTime((claims.exp as number) ?? nowS + 3600)
    .sign(opts.key ?? priv);
}

const verify = (t: string | undefined, over: Partial<Parameters<typeof verifyIdToken>[1]> = {}) =>
  verifyIdToken(t, { projectId: PROJECT, mode: 'firebase', requestHost: 'skitrip.example.workers.dev', keys, ...over });

async function code(p: Promise<unknown>) {
  try { await p; return 'ok'; } catch (e) { return e instanceof AuthError ? e.code : `other:${e}`; }
}

describe('verificación de ID tokens (modo producción)', () => {
  it('acepta un token válido firmado con una clave publicada y usa sub como identidad', async () => {
    const info = await verify(await sign());
    expect(info.uid).toBe('uid-1');
    expect(info.email).toBe('a@b.test');
  });
  it('no exige email verificado', async () => {
    expect(await code(verify(await sign({ email_verified: false })))).toBe('ok');
  });
  it('rechaza token ausente', async () => expect(await code(verify(undefined))).toBe('missing'));
  it('rechaza token caducado', async () => {
    const nowS = Math.floor(Date.now() / 1000);
    expect(await code(verify(await sign({ iat: nowS - 7200, exp: nowS - 3600, auth_time: nowS - 7200 })))).toBe('expired');
  });
  it('rechaza firma de otra clave', async () => expect(await code(verify(await sign({}, { key: otherPriv })))).toBe('invalid'));
  it('rechaza kid desconocido', async () => expect(await code(verify(await sign({}, { kid: 'nope' })))).toBe('invalid'));
  it('rechaza otra audiencia', async () => expect(await code(verify(await sign({ aud: 'otro-proyecto' })))).toBe('invalid'));
  it('rechaza otro emisor', async () => expect(await code(verify(await sign({ iss: 'https://evil.example' })))).toBe('invalid'));
  it('rechaza sub vacío', async () => expect(await code(verify(await sign({ sub: '' })))).toBe('invalid'));
  it('rechaza iat en el futuro', async () => {
    const nowS = Math.floor(Date.now() / 1000);
    expect(await code(verify(await sign({ iat: nowS + 600, auth_time: nowS })))).toBe('invalid');
  });
  it('rechaza alg none en producción (token del emulador)', async () => {
    const nowS = Math.floor(Date.now() / 1000);
    const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '');
    const t = `${b64({ alg: 'none' })}.${b64({ iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: 'x', iat: nowS, exp: nowS + 60, auth_time: nowS })}.`;
    expect(await code(verify(t))).toBe('invalid');
  });
  it('el modo emulador se niega fuera de localhost', async () => {
    expect(await code(verify('a.b.', { mode: 'emulator' }))).toBe('emulator_not_allowed');
  });
});
