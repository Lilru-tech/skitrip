/**
 * Update open km (km abiertos) for resorts.json
 *
 * Requisitos:
 *   npm i playwright
 *   npx playwright install
 *
 * Uso:
 *   node tools/update-open-km.js ./data/resorts.json
 *   node tools/update-open-km.js ./data/resorts.json --debug
 *   node tools/update-open-km.js ./data/resorts.json --headed
 *
 * Qué hace:
 *   - Entra una sola vez en:
 *       https://www.esquiades.com/informacion-interes/estado-pistas/
 *   - Extrae para cada estación la celda "Kms" con formato "X / Y"
 *       X = km abiertos (openKm)
 *       Y = km totales (kmTotal) -> solo se rellena si en resorts.json es null
 *   - Actualiza:
 *       pricing.openKm
 *       (opcional) kmTotal si era null
 *   - Guarda también:
 *       pricing.openKmSource = "esquiades_estado_pistas"
 *       pricing.openKmUrl    = la URL usada
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const INPUT = process.argv[2];
if (!INPUT) {
  console.error('Uso: node tools/update-open-km.js ./data/resorts.json');
  process.exit(1);
}

const headed = process.argv.includes('--headed');
const debug = process.argv.includes('--debug');

const ESQUIADES_STATUS_URL = 'https://www.esquiades.com/informacion-interes/estado-pistas/';

// Mapeo robusto: tu resort.id -> cómo aparece el nombre en Esquiades (normalizado)
const RESORT_NAME_MAP = {
  grandvalira: ['grandvalira'],
  'pal-arinsal': ['vallnord pal-arinsal', 'pal-arinsal', 'vallnord pal arinsal'],
  'ordino-arcalis': ['ordino-arcalis', 'ordino arcalis', 'ordino-arcalís', 'ordino arcalís'],

  'alp-2500': ['alp 2500', 'alp 2500 (la molina+masella)', 'alp 2500 (la molina + masella)'],
  'baqueira-beret': ['baqueira beret', 'baqueira'],
  'port-aine': ['port ainé', 'port aine'],
  'espot-esqui': ['espot esqui', 'espot esquí'],
  'boi-taull': ['boí taüll', 'boi taull'],
  'port-del-comte': ['port del comte'],
  'vall-de-nuria': ['vall de núria', 'vall de nuria'],

  cerler: ['cerler'],
  'formigal-panticosa': ['formigal - panticosa', 'formigal panticosa', 'formigal'],
  astun: ['astún', 'astun'],
  candanchu: ['candanchú', 'candanchu'],
  valdelinares: ['valdelinares'],
  javalambre: ['javalambre'],

  'font-romeu-pyrenees-2000': [
    'font-romeu',
    'font romeu',
    'font-romeu pyrénées 2000',
    'font-romeu pyrenees 2000',
  ],
  'les-angles': ['les angles'],
  'ax-3-domaines': ['ax 3 domaines', 'ax-3-domaines'],
};

const HISTORY_PATH = path.resolve(__dirname, '..', 'data', 'open_km_history.json');

function todayYMD() {
  // GitHub Actions corre en UTC -> perfecto para “día”
  return new Date().toISOString().slice(0, 10);
}

function readOpenKmHistory() {
  try {
    if (!fs.existsSync(HISTORY_PATH)) return { byResortId: {} };
    const raw = fs.readFileSync(HISTORY_PATH, 'utf8');
    const json = JSON.parse(raw);
    return json && json.byResortId ? json : { byResortId: {} };
  } catch {
    return { byResortId: {} };
  }
}

function writeOpenKmHistory(hist) {
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(hist, null, 2), 'utf8');
}

function upsertHistoryPoint(hist, resortId, point) {
  hist.byResortId[resortId] = hist.byResortId[resortId] || [];
  const arr = hist.byResortId[resortId];

  // si ya existe entrada de hoy -> reemplaza (por si re-ejecutas el workflow)
  const i = arr.findIndex((x) => x.date === point.date);
  if (i >= 0) arr[i] = point;
  else arr.push(point);

  // mantener orden por fecha
  arr.sort((a, b) => a.date.localeCompare(b.date));

  // opcional: limitar histórico (ej. 365 días)
  const MAX = 365;
  if (arr.length > MAX) hist.byResortId[resortId] = arr.slice(arr.length - MAX);
}

function normalizeName(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita acentos
    .replace(/\s+/g, ' ')
    .trim();
}

async function maybeDebugDump(page, prefix) {
  if (!debug) return;
  try {
    await page.screenshot({ path: `${prefix}.png`, fullPage: true });
  } catch {}
  try {
    fs.writeFileSync(`${prefix}.html`, await page.content(), 'utf8');
  } catch {}
  try {
    const t = await page.evaluate(() => document.body?.innerText || '');
    fs.writeFileSync(`${prefix}.txt`, t, 'utf8');
  } catch {}
}

async function clickCookieIfPresent(page) {
  const patterns = [
    /aceptar/i,
    /accept/i,
    /entendido/i,
    /de acuerdo/i,
    /consent/i,
    /allow/i,
    /ok/i,
  ];

  for (const re of patterns) {
    const btn = page.getByRole('button', { name: re });
    try {
      const c = await btn.count();
      if (c > 0) {
        await btn
          .first()
          .click({ timeout: 1500 })
          .catch(() => {});
        return true;
      }
    } catch {}
  }
  return false;
}

/**
 * Extrae del DOM una lista de items:
 *   { name: "Grandvalira", kmsText: "78 / 215", openKm: 78, totalKm: 215 }
 *
 * Importante: lo hacemos con evaluate() para ir directos al DOM renderizado.
 */
async function scrapeEsquiadesStatus(page) {
  await page.goto(ESQUIADES_STATUS_URL, { waitUntil: 'networkidle', timeout: 60000 });
  await clickCookieIfPresent(page);
  await page.waitForTimeout(1200);
  await page.waitForSelector('body', { timeout: 10000 });

  // Intenta localizar “filas/cards” que contengan un nombre + una celda “Kms”
  // Como Esquiades puede cambiar markup, lo hacemos por texto y estructura flexible.
  const rows = await page.evaluate(() => {
    const out = [];

    const clean = (s) =>
      (s || '')
        .replace(/\u00A0/g, ' ')
        .replace(/[‐-‒–—―]/g, '-')
        .replace(/\s+/g, ' ')
        .trim();

    // 1) Encontrar “celdas pequeñas” que contengan un X/Y (kms)
    // Ojo: usamos textContent porque innerText a veces te devuelve el contenedor gigante.
    const kmCells = Array.from(document.querySelectorAll('body *'))
      .map((el) => {
        const t = clean(el.textContent || '');
        return { el, t };
      })
      .filter((x) => {
        if (!/(\d{1,3}|-)\s*\/\s*(\d{1,3})/.test(x.t)) return false;
        if (x.t.length > 25) return false;

        const p = x.el.closest('a, div, span');
        const pt = clean(p?.textContent || '');
        return /\bKms\b/i.test(pt); // ✅ asegura que es la celda de Kms
      });

    // Para evitar duplicados (mismo kmText repetido en spans)
    const seenRow = new Set();

    // Helpers dentro del evaluate
    const countPairs = (s) => (clean(s).match(/(\d{1,3}|-)\s*\/\s*(\d{1,3})/g) || []).length;

    function climbToBestRow(startEl, kmText) {
      let cur = startEl;
      const hits = [];

      for (let i = 0; i < 15 && cur; i++) {
        const tt = clean(cur.textContent || '');
        const pairs = countPairs(tt);
        const hasStatus = /(abiert|cerrad)/i.test(tt);

        // Criterio “row”: contiene el mismo kmText, estado y
        // o bien tiene Kms y Pistas, o al menos 2 pares (kms+pistas)
        const hasKmText = tt.includes(kmText);
        const hasLabels = /\bKms\b/i.test(tt) && /\bPistas\b/i.test(tt);
        const letters = (tt.match(/[a-záéíóúñ]/gi) || []).length;
        const sizeOk = tt.length <= 260;
        const isRow = hasKmText && hasStatus && (hasLabels || pairs >= 2) && letters > 10 && sizeOk;

        if (isRow) hits.push({ el: cur, t: tt, len: tt.length });
        cur = cur.parentElement;
      }

      if (!hits.length) return null;
      hits.sort((a, b) => a.len - b.len); // ✅ “el más pequeño”, como has validado en consola
      return hits[0];
    }

    for (const cell of kmCells) {
      const m = cell.t.match(/(\d{1,3}|-)\s*\/\s*(\d{1,3})/);
      if (!m) continue;

      const kmText = `${m[1]} / ${m[2]}`;

      const bestRow = climbToBestRow(cell.el, kmText);
      if (!bestRow) continue;

      const key = kmText; // dedupe por el kmText (evita repetir el mismo 30/63 mil veces)
      if (seenRow.has(key)) continue;
      seenRow.add(key);

      // 2) openKm/totalKm salen del kmText (no del primer match del row)
      const openKm = m[1] === '-' ? 0 : Number(m[1]);
      const totalKm = Number(m[2]);

      // 3) Extraer nombre: es el inicio del row hasta la región/país
      // Ej: "Ordino-Arcalís Andorra Abierta Kms ..."
      let name = bestRow.t;
      const nameMatch = bestRow.t.match(
        /^(.+?)\s+(Andorra|Pirineo|Alpes|Otras|Serra|Sierra|Portugal|Suiza|Austria|Italia|Francia|Espana|España)\b/i
      );
      if (nameMatch) name = nameMatch[1];

      // Validaciones básicas
      if (!Number.isFinite(totalKm) || totalKm <= 0 || totalKm > 500) continue;
      if (openKm < 0 || openKm > totalKm) continue;

      out.push({ name, kmsText: kmText, openKm, totalKm });
    }

    return out;
  });

  if (!rows.length && debug) {
    await maybeDebugDump(page, 'debug-esquiades-status-no-rows');
  }

  // Normaliza y deduplica mejor por nombre
  const normalized = rows.map((r) => ({
    ...r,
    nameNorm: r.name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  }));

  // En caso de duplicados, nos quedamos con el que tenga totalKm mayor (suele ser el correcto)
  const bestByName = new Map();
  for (const r of normalized) {
    const prev = bestByName.get(r.nameNorm);
    if (!prev || r.totalKm > prev.totalKm) bestByName.set(r.nameNorm, r);
  }

  return Array.from(bestByName.values());
}

function findMatchForResort(resortId, scrapedRows) {
  const targets = RESORT_NAME_MAP[resortId] ?? [resortId];
  const targetNorms = targets.map(normalizeName);

  // match exacto por normalizado
  for (const t of targetNorms) {
    const hit = scrapedRows.find((r) => r.nameNorm === t);
    if (hit) return hit;
  }

  // match “contiene” (fallback)
  for (const t of targetNorms) {
    const hit = scrapedRows.find((r) => r.nameNorm.includes(t) || t.includes(r.nameNorm));
    if (hit) return hit;
  }

  return null;
}

(async () => {
  const raw = fs.readFileSync(INPUT, 'utf8');
  const resorts = JSON.parse(raw);

  const hist = readOpenKmHistory();
  const date = todayYMD();

  const browser = await chromium.launch({
    headless: !headed,
    slowMo: headed ? 200 : 0,
  });

  const context = await browser.newContext({
    locale: 'es-ES',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  console.log(`\n🌐 Scrapeando estado pistas Esquiades: ${ESQUIADES_STATUS_URL}`);
  const scraped = await scrapeEsquiadesStatus(page);

  if (debug) {
    fs.writeFileSync(
      'debug-esquiades-status-parsed.json',
      JSON.stringify(scraped, null, 2),
      'utf8'
    );
  }

  console.log(`✅ Filas detectadas (Esquiades): ${scraped.length}`);

  let updatedOpen = 0;
  let filledTotal = 0;
  let missing = 0;

  for (const r of resorts) {
    const hit = findMatchForResort(r.id, scraped);

    console.log(`\n[${r.id}] ${r.name}`);
    if (!hit) {
      console.log('  ⚠️ No match en Esquiades estado-pistas.');
      missing++;
      continue;
    }

    r.pricing = r.pricing || {};
    const prevOpen = r.pricing.openKm;

    r.pricing.openKm = hit.openKm;
    // ✅ Guardar histórico diario openKm
    upsertHistoryPoint(hist, r.id, {
      date,
      openKm: hit.openKm,
      totalKm: hit.totalKm,
    });
    r.pricing.openKmSource = 'esquiades_estado_pistas';
    r.pricing.openKmUrl = ESQUIADES_STATUS_URL;

    if (r.kmTotal == null && Number.isFinite(hit.totalKm)) {
      r.kmTotal = hit.totalKm;
      filledTotal++;
      console.log(`  🧩 kmTotal rellenado: ${hit.totalKm}`);
    }

    const changed = prevOpen !== hit.openKm;
    console.log(
      `  ✅ openKm=${hit.openKm} (total=${hit.totalKm}) ${changed ? '(actualizado)' : '(igual)'}`
    );
    updatedOpen++;
  }

  await browser.close();

  fs.writeFileSync(INPUT, JSON.stringify(resorts, null, 2), 'utf8');
  writeOpenKmHistory(hist);
  console.log(`📚 Histórico openKm actualizado: ${HISTORY_PATH}`);
  console.log(`\n✅ Guardado: ${path.resolve(INPUT)}`);
  console.log(`📌 Resorts con openKm actualizado: ${updatedOpen}`);
  console.log(`🧩 Resorts con kmTotal rellenado (si era null): ${filledTotal}`);
  console.log(`❓ Resorts sin match: ${missing}`);
})();
