import { describe, expect, it } from 'vitest';
import { detectBlock, looksBlocked } from '../../src/core/blocked';
import { pageFixture } from '../../src/core/parsers/fixture';
import estiber from '../fixtures/parsers/estiber-la-molina.reconstruido.html?raw';

// Páginas de prueba SINTÉTICAS (no son capturas): reproducen cada caso que el detector debe distinguir.
const filler = 'Ofertas de esquí con hotel y forfait para La Molina y Masella. '.repeat(40);
const page = (head: string, body: string) => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const recaptchaScript = '<script src="https://www.gstatic.com/recaptcha/releases/abc/recaptcha__es.js" async></script>';

describe('detectBlock · contenido normal con scripts auxiliares (caso Estiber, 01/10/2026)', () => {
  it('200 con el script de reCAPTCHA y contenido normal no es un bloqueo', () => {
    expect(detectBlock(200, page(`<title>Ofertas esquí La Molina</title>${recaptchaScript}`, `<main>${filler}</main>`))).toEqual({ blocked: false, reason: null });
  });
  it('el fixture de Estiber (script de reCAPTCHA en <head>) no es un bloqueo', () => {
    expect(looksBlocked(200, estiber)).toBe(false);
  });
  it('un script en línea que menciona grecaptcha o «captcha» tampoco', () => {
    const inline = '<script>window.grecaptcha && grecaptcha.ready(() => {}); var captchaKey = "x";</script>';
    expect(looksBlocked(200, page('<title>Parte de nieve</title>', `${inline}<p>${filler}</p>`))).toBe(false);
  });
  it('un widget de reCAPTCHA de un formulario (newsletter) en una página con contenido no es un bloqueo', () => {
    expect(looksBlocked(200, page('<title>Estiber</title>', `<p>${filler}</p><form><div class="g-recaptcha" data-sitekey="k"></div></form>`))).toBe(false);
  });
  it('«access denied» dentro de un texto largo (p. ej. condiciones) no es un bloqueo', () => {
    expect(looksBlocked(200, page('<title>Condiciones</title>', `<p>${filler} En caso de access denied al área privada, contacte.</p>`))).toBe(false);
  });
  it('un parte de nieve con el script de reCAPTCHA se sigue analizando (el agregador de nieve usa el mismo detector)', () => {
    const html = page(`<title>Parte de nieve</title>${recaptchaScript}`, `<p>${filler}</p><p>Emitido a las 09:00 h del 15 de enero de 2027 Km esquiables 50 / 100</p>`);
    expect(looksBlocked(200, html)).toBe(false);
  });
});

describe('detectBlock · bloqueos y desafíos reales: se para', () => {
  it('403 y 429 siempre', () => {
    expect(detectBlock(403, page('<title>Ofertas</title>', filler))).toEqual({ blocked: true, reason: 'HTTP 403' });
    expect(detectBlock(429, '')).toEqual({ blocked: true, reason: 'HTTP 429' });
  });
  it('desafío de Cloudflare («Just a moment…»), aunque responda 503 o 200', () => {
    const cf = page('<title>Just a moment...</title>', '<div id="challenge-form"><p>Checking if the site connection is secure</p></div><script>window._cf_chl_opt={}</script>');
    expect(detectBlock(503, cf).blocked).toBe(true);
    expect(detectBlock(200, cf).blocked).toBe(true);
  });
  it('página corta con un formulario CAPTCHA y nada más', () => {
    const r = detectBlock(200, page('<title>Estiber</title>', '<form><div class="g-recaptcha" data-sitekey="k"></div><button>Enviar</button></form>'));
    expect(r).toEqual({ blocked: true, reason: 'formulario CAPTCHA sin contenido' });
  });
  it('texto de verificación humana en una página corta', () => {
    expect(looksBlocked(200, page('<title>Comprobación</title>', '<p>Verifica que eres humano para continuar.</p>'))).toBe(true);
    expect(looksBlocked(200, page('<title>Hola</title>', '<h1>Are you a robot?</h1>'))).toBe(true);
    expect(looksBlocked(200, page('<title>Hola</title>', '<h1>Access denied</h1><p>Reference #18.abc</p>'))).toBe(true);
  });
  it('DataDome (iframe de captcha-delivery.com) en una página vacía', () => {
    expect(looksBlocked(200, page('<title>estiber.com</title>', '<iframe src="https://geo.captcha-delivery.com/captcha/?initialCid=x"></iframe>'))).toBe(true);
  });
  it('un marcador dentro de un <script src> no cuenta, pero la misma página corta con el formulario de desafío sí', () => {
    expect(looksBlocked(200, page('<title>Ofertas</title><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>', `<p>${filler}</p>`))).toBe(false);
  });
});

describe('fixture saneado', () => {
  it('quita scripts, parámetros de URL y formularios, y conserva clases y texto', () => {
    const out = pageFixture(page('<title>x</title>', `<div class="parte" onclick="t()"><a href="/p?session=abc#x">Parte</a><script>evil()</script><form><input name="email"></form><p>Km 5 / 10</p></div>`), { sourceId: 's', url: 'https://ejemplo.test/a', capturedAt: '2027-01-15T08:00:00Z', sha256: 'f'.repeat(64) });
    expect(out).toContain('<div class="parte"><a href="https://ejemplo.test/p">Parte</a><p>Km 5 / 10</p></div>');
    expect(out).not.toMatch(/session|evil|onclick|email|<script|<form/);
  });
});
