/**
 * Requisitos:
 *   npm i playwright
 *   npx playwright install
 *
 * Uso:
 *   node tools/update-esquiades-prices.js ./data/resorts.json
 *   node tools/update-esquiades-prices.js ./data/resorts.json --debug
 *   node tools/update-esquiades-prices.js ./data/resorts.json --headed
 *
 * Qué hace:
 *   - Para cada estación:
 *       1) intenta Esquiades (si hay URL)
 *       2) si falla, intenta Estiber (URL por slug auto-generada)
 *   - Lee el texto renderizado (innerText), no HTML
 *   - Extrae precios €/persona SOLO si el contexto indica “2 días” + “X noches” + forfait/skipass
 *   - Convierte cada precio de pack a €/persona/noche usando el nº de noches detectado (1/2/3)
 *   - Saca top10 unidades (€/persona/noche) y calcula:
 *       hotelForfaitCheapest = min(units)
 *       hotelForfaitTop10Avg = avg(units)
 *   - Escribe en:
 *       pricing.hotelForfaitCheapest
 *       pricing.hotelForfaitTop10Avg
 *     y también:
 *       pricing.priceSource = "esquiades" | "estiber"
 *       pricing.priceUrl = <url usada>
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const INPUT = process.argv[2];
if (!INPUT) {
  console.error("Uso: node tools/update-esquiades-prices.js ./data/resorts.json");
  process.exit(1);
}

const headed = process.argv.includes("--headed");
const debug  = process.argv.includes("--debug");

function avg(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ✅ Tus URLs de Esquiades (las que tengas)
const ESQUIADES_URL = {
  // --- Andorra ---
  "grandvalira": "https://www.esquiades.com/viajes-esqui/esqui-fin-de-semana-grandvalira-130041",
  "pal-arinsal": "https://www.esquiades.com/viajes-esqui/pal-arinsal-1451",
  "ordino-arcalis": "https://www.esquiades.com/viajes-esqui/arcalis-1453",

  // --- Cataluña ---
  "alp-2500": "https://www.esquiades.com/viajes-esqui/2-noches-1-dia-de-forfait-alp2500-1305769",
  "baqueira-beret": "https://www.esquiades.com/viajes-esqui/1-noche-2-dias-de-forfait-baqueira-beret-1305762",
  "port-aine": "https://www.esquiades.com/viajes-esqui/2-noches-1-dia-de-forfait-port-aine-1305766",
  "espot-esqui": "https://www.esquiades.com/viajes-esqui/2-noches-1-dia-de-forfait-espot-1305765",
  "port-del-comte": "https://www.esquiades.com/viajes-esqui/2-noches-1-dia-de-forfait-port-del-comte-1305764",
  "boi-taull": "https://www.esquiades.com/viajes-esqui/esqui-fin-de-semana-boi-taull-1300410",

  "vallter-2000": null,
  "vall-de-nuria": "https://www.esquiades.com/viajes-esqui/esqui-fin-de-semana-vall-de-nuria-1300462",
  "tuixent-la-vansa": null,
  "tavascan": null,

  // --- Aragón ---
  "cerler": "https://www.esquiades.com/viajes-esqui/cerler-1418",
  "formigal-panticosa": "https://www.esquiades.com/viajes-esqui/2-noches-1-dia-de-forfait-formigal-1305761",
  "astun": "https://www.esquiades.com/viajes-esqui/astun-1435",
  "candanchu": null,
  "valdelinares": "https://www.esquiades.com/viajes-esqui/2-noches-1-dia-de-forfait-valdelinares-1305760",
  "javalambre": null,

  // --- Francia ---
  "font-romeu-pyrenees-2000": null,
  "les-angles": null,
  "formigueres": null,
  "porte-puymorens": null,
  "ax-3-domaines": null,
  "cambre-d-aze": null
};

/**
 * Estiber: generamos URLs por slug.
 * Patrón habitual:
 *   https://www.estiber.com/es_ES/ofertas-esqui-<slug>
 */
const ESTIBER_SLUG = {
  // Andorra
  "grandvalira": ["grandvalira"],
  "pal-arinsal": ["pal-arinsal", "pal-arinsal-andorra"],
  "ordino-arcalis": ["arcalis", "ordino-arcalis"],

  // Cataluña
  "alp-2500": ["alp-2500", "alp2500", "la-molina", "masella"],
  "baqueira-beret": ["baqueira-beret", "baqueira"],
  "port-aine": ["port-aine"],
  "espot-esqui": ["espot", "espot-esqui"],
  "port-del-comte": ["port-del-comte"],
  "boi-taull": ["boi-taull"],
  "vallter-2000": ["vallter-2000", "vallter"],
  "vall-de-nuria": ["vall-de-nuria", "nuria", "vall-nuria"],
  "tuixent-la-vansa": ["tuixent-la-vansa", "tuixent"],
  "tavascan": ["tavascan"],

  // Aragón
  "cerler": ["cerler"],
  "formigal-panticosa": ["formigal", "formigal-panticosa", "panticosa"],
  "astun": ["astun-candanchu", "astun"],
  "candanchu": ["astun-candanchu", "candanchu"],
  "valdelinares": ["valdelinares"],
  "javalambre": ["javalambre"],

  // Francia
  "font-romeu-pyrenees-2000": ["font-romeu", "font-romeu-pyrenees-2000"],
  "les-angles": ["les-angles"],
  "formigueres": ["formigueres"],
  "porte-puymorens": ["porte-puymorens", "porte"],
  "ax-3-domaines": ["ax-3-domaines", "ax-les-thermes"],
  "cambre-d-aze": ["cambre-d-aze"]
};

function buildEstiberUrls(resortId) {
  const slugs = ESTIBER_SLUG[resortId] || [resortId];
  const arr = Array.isArray(slugs) ? slugs : [slugs];
  return arr.map(s => `https://www.estiber.com/es_ES/ofertas-esqui-${s}`);
}

async function maybeDebugDump(page, prefix) {
  if (!debug) return;
  try { await page.screenshot({ path: `${prefix}.png`, fullPage: true }); } catch {}
  try { fs.writeFileSync(`${prefix}.html`, await page.content(), "utf8"); } catch {}
  try {
    const t = await page.evaluate(() => document.body?.innerText || "");
    fs.writeFileSync(`${prefix}.txt`, t, "utf8");
  } catch {}
}

async function clickCookieIfPresent(page) {
  const candidates = [
    /aceptar/i, /accept/i, /entendido/i, /de acuerdo/i, /consent/i, /allow/i
  ];
  for (const re of candidates) {
    const btn = page.getByRole("button", { name: re });
    try {
      const c = await btn.count();
      if (c > 0) {
        await btn.first().click({ timeout: 1500 }).catch(() => {});
        return;
      }
    } catch {}
  }
}

/**
 * Extrae precios desde texto renderizado con “contexto”:
 * - €/persona (o pers)
 * - y cerca: noches + (forfait OR skipass)
 * - y cerca: días/dia (opcional, pero ayuda)
 */
function extractUnitPrices2DaysFromText(bodyText) {
  if (!bodyText) return [];

  const text = bodyText.replace(/\u00A0/g, " ");
  const lower = text.toLowerCase();

  const priceRe = /(\d{2,4})(?:[.,](\d{1,2}))?\s*€/g;

  const unitHits = [];
  let m;

  while ((m = priceRe.exec(text)) !== null) {
    const euros = Number(m[1]);
    const cents = m[2] ? Number((m[2] + "0").slice(0, 2)) : 0;
    const price = euros + cents / 100;

    if (!Number.isFinite(price)) continue;
    if (price < 60 || price > 2500) continue;

    const idx = m.index;
    const win = lower.slice(Math.max(0, idx - 280), Math.min(lower.length, idx + 280));

    const hasPerPerson =
      win.includes("persona") ||
      win.includes("pers") ||
      win.includes("/pers") ||
      win.includes("€/pers") ||
      win.includes("/persona") ||
      win.includes("por persona");

    if (!hasPerPerson) continue;

    const hasPass =
      win.includes("forfait") ||
      win.includes("skipass") ||
      win.includes("ski pass");

    if (!hasPass) continue;

    // --- detectar Nº de días ---
    let daysCount = null;
    const daysMatch =
      win.match(/\b([123])\s*d[ií]as?\b/) ||
      win.match(/\b([123])\s*dies\b/) ||
      win.match(/\b([123])\s*days?\b/)

    if (daysMatch) daysCount = Number(daysMatch[1]);

    // ✅ SOLO 2 días
    if (daysCount !== 2) continue;

    // --- detectar Nº de noches ---
    let nightsCount = null;
    const nightsMatch =
      win.match(/\b([123])\s*noches?\b/) ||
      win.match(/\b([123])\s*nits\b/) ||
      win.match(/\b([123])\s*nights?\b/);

    if (nightsMatch) nightsCount = Number(nightsMatch[1]);

    // Si no encontramos noches, no podemos normalizar a €/noche con fiabilidad
    if (!nightsCount) continue;

    const unit = price / nightsCount;
    unitHits.push(unit);
  }

  unitHits.sort((a, b) => a - b);
  return unitHits.slice(0, 10);
}

async function gotoWithRetries(page, url, tries = 2) {
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
      return true;
    } catch (e) {
      lastErr = e;
      // pequeño backoff
      await page.waitForTimeout(800 + i * 500).catch(() => {});
    }
  }
  throw lastErr;
}

async function scrapeTop10FromUrl(page, providerName, url, resortId) {
  await gotoWithRetries(page, url, 2);
  await clickCookieIfPresent(page);

  await page.waitForSelector("body", { timeout: 15000 });
  await page.waitForTimeout(1200);

  const bodyText = await page.evaluate(() => document.body?.innerText || "");
  const prices = extractUnitPrices2DaysFromText(bodyText);

  if (prices.length === 0) {
    await maybeDebugDump(page, `debug-${providerName}-${resortId}-no-prices`);
  }

  return prices;
}

async function scrapeEsquiades(page, resortId) {
  const url = ESQUIADES_URL[resortId];
  if (!url) return { prices: [], url: null };
  const prices = await scrapeTop10FromUrl(page, "esquiades", url, resortId);
  return { prices, url };
}

async function scrapeEstiber(page, resortId) {
  const urls = buildEstiberUrls(resortId);
  for (const url of urls) {
    try {
      const prices = await scrapeTop10FromUrl(page, "estiber", url, resortId);
      if (prices.length >= 3) return { prices, url };
      // si devuelve 1-2 precios, seguimos probando otro slug
    } catch (e) {
      if (debug) console.log(`  [estiber] fallo URL ${url}: ${e.message}`);
    }
  }
  return { prices: [], url: urls[0] || null };
}

(async () => {
  const raw = fs.readFileSync(INPUT, "utf8");
  const resorts = JSON.parse(raw);

  const browser = await chromium.launch({
    headless: !headed,
    slowMo: headed ? 200 : 0
  });

  const context = await browser.newContext({
    locale: "es-ES",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
  });

  const page = await context.newPage();

  for (const r of resorts) {
    console.log(`\n[${r.id}]`);

    let used = null; // "esquiades" | "estiber"
    let usedUrl = null;
    let prices = [];

    // 1) Esquiades primero
    try {
      const res = await scrapeEsquiades(page, r.id);
      prices = res.prices;
      usedUrl = res.url;
      if (prices.length >= 3) used = "esquiades";
      console.log(`  Esquiades: ${res.url ?? "MISSING"} -> ${prices.length} precios`);
    } catch (e) {
      console.log(`  Esquiades ERROR: ${e.message}`);
      if (debug) await maybeDebugDump(page, `debug-esquiades-${r.id}-error`);
    }

    // 2) Si no sirve, Estiber
    if (!used) {
      try {
        const res2 = await scrapeEstiber(page, r.id);
        prices = res2.prices;
        usedUrl = res2.url;
        if (prices.length >= 3) used = "estiber";
        console.log(`  Estiber: ${res2.url ?? "MISSING"} -> ${prices.length} precios`);
      } catch (e) {
        console.log(`  Estiber ERROR: ${e.message}`);
        if (debug) await maybeDebugDump(page, `debug-estiber-${r.id}-error`);
      }
    }

    if (!used) {
      console.log(`  ⚠️ No encontré suficientes precios (solo ${prices.length}). Mantengo valores actuales.`);
      continue;
    }

    const unitCheapest = prices[0];
    const unitTop10Avg = avg(prices);
    
    r.pricing = r.pricing || {};
    r.pricing.hotelForfaitCheapest = round2(unitCheapest);
    r.pricing.hotelForfaitTop10Avg = round2(unitTop10Avg);
    r.pricing.priceSource = used;
    r.pricing.priceUrl = usedUrl;

    console.log(`  ✅ source=${used} | top10 unit(€/noche) 2-días: ${prices.map(p => p.toFixed(2)).join(", ")} €`);
    console.log(`  -> cheapest_unit=${r.pricing.hotelForfaitCheapest} | top10avg_unit=${r.pricing.hotelForfaitTop10Avg}`);
  }

  await browser.close();

  fs.writeFileSync(INPUT, JSON.stringify(resorts, null, 2), "utf8");
  console.log(`\n✅ Actualizado: ${path.resolve(INPUT)}`);
})();