// ¿La respuesta es una página de bloqueo o desafío (CAPTCHA) en lugar del contenido?
// Ante un bloqueo los recolectores se paran y lo registran; nunca lo evaden.
//
// Un script auxiliar no es un bloqueo: Estiber (01/10/2026) devuelve 200 con su contenido normal y carga
// https://www.gstatic.com/recaptcha/releases/…/recaptcha__es.js para sus formularios. Por eso no se busca
// «captcha» en el HTML crudo: se miran el estado, el título, el texto visible y los marcadores de desafío.
import { findAll, parseHtml, textContent } from './parsers/html';

export interface BlockVerdict {
  blocked: boolean;
  reason: string | null;
}

/** Frases que solo aparecen en páginas de desafío o denegación. */
const CHALLENGE_TEXT =
  /are you a (robot|human)|verify (that )?you are (a )?human|verifica(r)? que eres (un )?humano|confirma que no eres un robot|checking (if the site connection is secure|your browser)|unusual traffic from your (computer )?network|access denied|acceso denegado|request blocked|you have been blocked|has sido bloquead|enable javascript and cookies to continue/i;
const CHALLENGE_TITLE = /^(just a moment|un momento|attention required|access denied|acceso denegado|captcha|are you a robot|security check|verificaci[oó]n de seguridad|pardon our interruption)\b/i;
/** Marcadores de las páginas de desafío conocidas (Cloudflare, DataDome, PerimeterX, Imperva). */
const CHALLENGE_MARKUP = /id=["']challenge-form["']|cf-chl-widget|_cf_chl_opt|cf-challenge|captcha-delivery\.com|px-captcha|_incapsula_resource|id=["']cf-turnstile|class=["'][^"']*\bcf-turnstile\b/i;
/** Un widget de CAPTCHA en el cuerpo (no un <script src>): solo es bloqueo si casi no hay contenido. */
const CAPTCHA_WIDGET = (cls: string) => /\b(g-recaptcha|h-captcha|cf-turnstile|captcha)\b/i.test(cls);
/** Por debajo de este texto visible, una página con widget o marcador de desafío se considera bloqueo. */
const THIN_TEXT = 1500;

export function detectBlock(status: number, html: string): BlockVerdict {
  if (status === 403 || status === 429) return { blocked: true, reason: `HTTP ${status}` };
  const doc = parseHtml(html); // sin el contenido de <script>, <style> ni <template>
  const title = findAll(doc, (e) => e.tag === 'title')[0];
  const titleText = title ? textContent(title).trim() : '';
  if (CHALLENGE_TITLE.test(titleText)) return { blocked: true, reason: `título «${titleText.slice(0, 60)}»` };

  const body = findAll(doc, (e) => e.tag === 'body')[0] ?? doc;
  const visible = textContent(body, (e) => e.tag === 'noscript' || e.tag === 'head').trim();
  const thin = visible.length < THIN_TEXT;
  const phrase = CHALLENGE_TEXT.exec(visible);
  // Una frase de desafío en una página corta es un bloqueo; en una página larga puede ser un texto legal o un aviso.
  if (phrase && thin) return { blocked: true, reason: `texto «${phrase[0]}»` };
  // Los marcadores se buscan en el HTML sin scripts para no confundir un <script src=…recaptcha…> con un desafío.
  const noScripts = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>|<script\b[^>]*\/>/gi, '');
  const markup = CHALLENGE_MARKUP.exec(noScripts);
  if (markup && thin) return { blocked: true, reason: `marcador de desafío «${markup[0]}»` };
  const widget = findAll(body, (e) => CAPTCHA_WIDGET(e.attrs.class ?? '') || CAPTCHA_WIDGET(e.attrs.id ?? ''))[0];
  if (widget && thin) return { blocked: true, reason: 'formulario CAPTCHA sin contenido' };
  return { blocked: false, reason: null };
}

export const looksBlocked = (status: number, html: string): boolean => detectBlock(status, html).blocked;
