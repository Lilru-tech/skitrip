'use strict';

console.log('[app.js] cargado ✅');

// 1) Orígenes predefinidos
const ORIGINS = {
  tarragona: { label: 'Tarragona', lat: 41.1189, lon: 1.2445 },
  sabadell: { label: 'Sabadell', lat: 41.5486, lon: 2.1076 },
};

const RESORTS_URL = './data/resorts.json';

// Estado
let cachedResorts = [];
let customOrigin = null;
let currentRows = []; // filas ya calculadas (con costes + score)
let sortState = { key: 'score', dir: 'desc' }; // orden inicial
window.commentsCountMap = {};
console.log('[app.js] commentsCountMap init:', window.commentsCountMap);

// Helpers DOM
function $(id) {
  return document.getElementById(id);
}

function setStatus(msg) {
  const el = $('statusText');
  if (el) el.textContent = msg;
}

function updateGroceriesSummary(tripDays, numPeople) {
  const el = $('groceriesSummary');
  if (!el) return;

  const total = window.computeGroceriesTotal?.(tripDays) ?? 0;
  const perPerson = window.computeGroceriesPerPerson?.(tripDays, numPeople) ?? 0;

  el.textContent = `Total compra: ${euro(total)} · ${euro(perPerson)}/persona`;
}

// Haversine
function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;

  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);

  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(x));
}

// -----------------------------
// Distancias reales por carretera (hardcode)
// km desde origen -> resort.id
// Nota: pon aquí los kms reales que quieras (Google Maps, etc.)
// -----------------------------
const ROAD_DISTANCE_KM = {
  tarragona: {
    grandvalira: 260,
    'pal-arinsal': 250,
    'ordino-arcalis': 255,
    'alp-2500': 195,
    'baqueira-beret': 270,
    'port-aine': 225,
    'espot-esqui': 250,
    'boi-taull': 255,
    'port-del-comte': 145,
    'vall-de-nuria': 215,
    cerler: 295,
    'formigal-panticosa': 350,
    astun: 315,
    candanchu: 405,
    valdelinares: 270,
    javalambre: 330,
    'font-romeu-pyrenees-2000': 265,
    'les-angles': 270,
    'ax-3-domaines': 310,
  },

  sabadell: {
    grandvalira: 160,
    'pal-arinsal': 165,
    'ordino-arcalis': 175,
    'alp-2500': 120,
    'baqueira-beret': 210,
    'port-aine': 165,
    'espot-esqui': 190,
    'boi-taull': 190,
    'port-del-comte': 115,
    'vall-de-nuria': 130,
    cerler: 225,
    'formigal-panticosa': 280,
    astun: 250,
    candanchu: 330,
    valdelinares: 340,
    javalambre: 395,
    'font-romeu-pyrenees-2000': 145,
    'les-angles': 155,
    'ax-3-domaines': 175,
  },
};

// Devuelve km reales si existen (y son número), si no -> null
function getRoadDistanceKm(originKey, resortId) {
  const v = ROAD_DISTANCE_KM?.[originKey]?.[resortId];
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

// Cargar resorts.json
async function loadResorts() {
  const res = await fetch(`${RESORTS_URL}?v=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`No se pudo cargar ${RESORTS_URL} (${res.status})`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('resorts.json debe ser un array JSON');
  return data;
}

function jsonp(url) {
  return new Promise((resolve, reject) => {
    const cb = '__jsonp_cb_' + Math.random().toString(36).slice(2);

    const script = document.createElement('script');
    const cleanup = () => {
      try {
        delete window[cb];
      } catch {}
      script.remove();
    };

    window[cb] = (data) => {
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error('JSONP request failed'));
    };

    const sep = url.includes('?') ? '&' : '?';
    script.src = `${url}${sep}callback=${encodeURIComponent(cb)}`;
    document.body.appendChild(script);
  });
}

async function loadCommentsCount() {
  try {
    const url =
      'https://script.google.com/macros/s/AKfycbxiZhDqPpPTAV4En1UHysdFFljXNpdpi65WEGQQkHCuTjRLjHVdic60duPHmorRrTq4OQ/exec?resource=comments&action=count';
    const data = await jsonp(url);

    window.commentsCountMap = data?.counts || {};

    console.log('[app.js] commentsCountMap LOADED ✅', window.commentsCountMap);

    // ✅ IMPORTANTÍSIMO: si la tabla ya está pintada, la repintamos para que aparezcan los badges
    if (currentRows?.length) {
      renderRows(currentRows);
    }
  } catch (e) {
    console.warn('No se pudieron cargar los contadores de comentarios', e);
    window.commentsCountMap = {};
  }
}

function hasValidLocation(r) {
  return (
    r && r.location && typeof r.location.lat === 'number' && typeof r.location.lon === 'number'
  );
}

// ------------- leer configuración del viaje -------------
function readTripConfig() {
  const numPeople = Number($('numPeople')?.value || 6);
  const numCars = Number($('numCars')?.value || 1);

  const fuelConsumption = Number($('fuelConsumption')?.value || 6.8); // L/100
  const fuelPrice = Number($('fuelPrice')?.value || 1.65); // €/L

  const tollsTotal = Number($('tollsTotal')?.value || 0); // total (ida+vuelta)
  const parkingPerDay = Number($('parkingPerDay')?.value || 0);
  const parkingDays = Number($('parkingDays')?.value || 0);

  const skiDays = Number($('skiDays')?.value || 2);
  const nights = Number($('nights')?.value || 2);
  const tripDays = Number($('skiDays')?.value || 2);
  const tripDateStr = $('tripDate')?.value || null; // "YYYY-MM-DD"

  return {
    numPeople: Math.max(1, numPeople),
    numCars: Math.max(1, numCars),
    fuelConsumption: Math.max(0, fuelConsumption),
    fuelPrice: Math.max(0, fuelPrice),
    tollsTotal: Math.max(0, tollsTotal),
    parkingPerDay: Math.max(0, parkingPerDay),
    parkingDays: Math.max(0, parkingDays),
    skiDays: Math.max(0, skiDays),
    tripDays: Math.max(0, tripDays),
    nights: Math.max(1, nights),
    tripDateStr,
  };
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function euro(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return `${round2(n).toFixed(2)} €`;
}

function clamp01(x) {
  if (x == null || Number.isNaN(x)) return null;
  return Math.max(0, Math.min(1, x));
}

// Normaliza a 0..1 (si higherIsBetter=true, max->1; si false, min->1)
function normalize(value, min, max, higherIsBetter) {
  if (value == null || Number.isNaN(value)) return null;
  if (min == null || max == null || Number.isNaN(min) || Number.isNaN(max) || max === min)
    return 0.5;

  const t = (value - min) / (max - min); // 0..1
  const n = higherIsBetter ? t : 1 - t;
  return clamp01(n);
}

// Calcula score 0..100 y devuelve desglose
function computeScore(row, ranges) {
  // Pesos (ajústalos cuando quieras)
  const W = {
    openKm: 0.3,
    total: 0.25,
    distance: 0.1,
    kmTotal: 0.1,
    vibe: 0.1,
    apres: 0.08,
    hotelForfait: 0.04,
    rental: 0.03,
  };

  const labels = {
    total: 'Total €/persona',
    distance: 'Distancia (km)',
    kmTotal: 'KMs totales',
    openKm: 'Km abiertos',
    vibe: 'Ambiente',
    apres: 'Après',
    hotelForfait: 'Hotel+Forfait €/p',
    rental: 'Alquiler material €/p',
  };

  const nTotal = normalize(row.totalPerPerson, ranges.totalMin, ranges.totalMax, false);
  const nDist = normalize(row.distanceKm, ranges.distMin, ranges.distMax, false);
  const nKm = normalize(row.kmTotal, ranges.kmMin, ranges.kmMax, true);
  const nOpenKm = normalize(row.openKm, ranges.openKmMin, ranges.openKmMax, true);
  const nVibe = normalize(row.vibeScore, ranges.vibeMin, ranges.vibeMax, true);
  const nApres = normalize(row.apresScore, ranges.apresMin, ranges.apresMax, true);
  const nHF = normalize(row.hotelForfaitPerPerson, ranges.hfMin, ranges.hfMax, false);
  const nRent = normalize(row.rentalPerPerson, ranges.rentMin, ranges.rentMax, false);

  const parts = [
    ['total', nTotal, row.totalPerPerson],
    ['distance', nDist, row.distanceKm],
    ['kmTotal', nKm, row.kmTotal],
    ['openKm', nOpenKm, row.openKm],
    ['vibe', nVibe, row.vibeScore],
    ['apres', nApres, row.apresScore],
    ['hotelForfait', nHF, row.hotelForfaitPerPerson],
    ['rental', nRent, row.rentalPerPerson],
  ];

  let weightSum = 0;
  let acc = 0;
  const breakdown = [];

  for (const [k, v, raw] of parts) {
    if (v == null) continue;
    const w = W[k];
    weightSum += w;
    acc += v * w;

    breakdown.push({
      key: k,
      label: labels[k] || k,
      raw,
      norm: v,
      weight: w,
      contrib01: v * w, // contribución en escala 0..1 (antes de dividir por weightSum)
    });
  }

  if (weightSum === 0) return { score: null, breakdown: [], weightSum: 0 };

  const score01 = acc / weightSum;
  const score100 = score01 * 100;

  // contribución final ya “normalizada” al score total (suma aprox = score01)
  const breakdownFinal = breakdown.map((x) => ({
    ...x,
    contrib01Final: x.contrib01 / weightSum,
    contrib100: (x.contrib01 / weightSum) * 100,
  }));

  return { score: score100, breakdown: breakdownFinal, weightSum };
}

function parseDateYMD(s) {
  if (!s) return null;
  const d = new Date(s + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? null : d;
}

// Devuelve multiplicador y etiqueta
function getSeasonMultiplier(dateObj) {
  if (!dateObj) return { label: 'Media', mult: 1.0 };

  const m = dateObj.getMonth() + 1; // 1-12
  const day = dateObj.getDate();

  // Pico: 20 dic - 6 ene
  if ((m === 12 && day >= 20) || (m === 1 && day <= 6)) {
    return { label: 'Pico', mult: 1.4 };
  }

  // Alta: ene (7-31), feb, mar
  if ((m === 1 && day >= 7) || m === 2 || m === 3) {
    return { label: 'Alta', mult: 1.25 };
  }

  // Baja: nov y abril
  if (m === 11 || m === 4) {
    return { label: 'Baja', mult: 0.9 };
  }

  // Media: resto
  return { label: 'Media', mult: 1.0 };
}

// ------------- helpers para pricing -------------
function getRentalAvgPerDay(resort) {
  const v = resort?.pricing?.rentalAvgPerDay;
  if (typeof v === 'number') return v;

  if (typeof resort?.defaultRentalPrice === 'number') return resort.defaultRentalPrice;
  return null;
}

function getHotelForfaitPrice(resort) {
  const cheapest = resort?.pricing?.hotelForfaitCheapest;
  if (typeof cheapest === 'number') return cheapest;

  const avg = resort?.pricing?.hotelForfaitTop10Avg;
  if (typeof avg === 'number') return avg;

  return null;
}

// ------------- cálculos de costes €/persona -------------
function computeCostsPerPerson(resort, tripCfg) {
  const distanceKm = resort.distanceKm ?? 0;
  const roundTripKm = distanceKm * 2;

  const litersPerCar = roundTripKm * (tripCfg.fuelConsumption / 100);
  const fuelCostPerCar = litersPerCar * tripCfg.fuelPrice;
  const fuelCostTotal = fuelCostPerCar * tripCfg.numCars;

  const parkingTotal = tripCfg.parkingPerDay * tripCfg.parkingDays;
  const extraTotal = tripCfg.tollsTotal + parkingTotal;

  const tripTotal = fuelCostTotal + extraTotal;
  const tripPerPerson = tripTotal / tripCfg.numPeople;

  const groceriesPerPerson =
    window.computeGroceriesPerPerson?.(tripCfg.tripDays, tripCfg.numPeople) ?? 0;

  const rentalDay = getRentalAvgPerDay(resort);
  const rentalPerPerson = typeof rentalDay === 'number' ? rentalDay * tripCfg.skiDays : null;

  const basePack = getHotelForfaitPrice(resort);
  let hotelForfaitPerPerson = null;
  if (typeof basePack === 'number') {
    const tripDate = parseDateYMD(tripCfg.tripDateStr);
    const season = getSeasonMultiplier(tripDate);
    hotelForfaitPerPerson = basePack * tripCfg.nights * season.mult;
  }

  let total = tripPerPerson + groceriesPerPerson;
  if (typeof rentalPerPerson === 'number') total += rentalPerPerson;
  if (typeof hotelForfaitPerPerson === 'number') total += hotelForfaitPerPerson;

  return {
    tripPerPerson,
    groceriesPerPerson,
    rentalPerPerson,
    hotelForfaitPerPerson,
    totalPerPerson: total,
  };
}

// Filtrar por radio
function filterResortsByRadius(resorts, origin, maxKm, originKey) {
  return resorts
    .filter((r) => hasValidLocation(r))
    .map((r) => {
      // 1) Si NO es “Mi ubicación” y tenemos hardcode -> usarlo
      const roadKm = !customOrigin && originKey ? getRoadDistanceKm(originKey, r.id) : null;

      // 2) Si no hay hardcode, fallback a Haversine
      const distanceKm =
        typeof roadKm === 'number'
          ? roadKm
          : haversineKm(origin, { lat: r.location.lat, lon: r.location.lon });

      return { ...r, distanceKm };
    })
    .filter((r) => r.distanceKm <= maxKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

function computeRanges(rows) {
  const getMinMax = (key) => {
    const vals = rows.map((r) => r[key]).filter((v) => typeof v === 'number' && !Number.isNaN(v));
    if (!vals.length) return { min: null, max: null };
    return { min: Math.min(...vals), max: Math.max(...vals) };
  };

  const total = getMinMax('totalPerPerson');
  const dist = getMinMax('distanceKm');
  const km = getMinMax('kmTotal');
  const openKm = getMinMax('openKm');
  const vibe = getMinMax('vibeScore');
  const apres = getMinMax('apresScore');
  const hf = getMinMax('hotelForfaitPerPerson');
  const rent = getMinMax('rentalPerPerson');

  return {
    totalMin: total.min,
    totalMax: total.max,
    distMin: dist.min,
    distMax: dist.max,
    kmMin: km.min,
    kmMax: km.max,
    openKmMin: openKm.min,
    openKmMax: openKm.max,
    vibeMin: vibe.min,
    vibeMax: vibe.max,
    apresMin: apres.min,
    apresMax: apres.max,
    hfMin: hf.min,
    hfMax: hf.max,
    rentMin: rent.min,
    rentMax: rent.max,
  };
}

function buildRows(filteredResorts, tripCfg) {
  const base = filteredResorts.map((r) => {
    const costs = computeCostsPerPerson(r, tripCfg);
    return {
      id: r.id,
      name: r.name,
      country: r.country,
      region: r.region,
      distanceKm: r.distanceKm ?? null,
      kmTotal: r.kmTotal ?? null,
      openKm: r.pricing?.openKm ?? null,
      vibeScore: r.vibeScore ?? null,
      apresScore: r.apresScore ?? null,
      ...costs,
    };
  });

  const ranges = computeRanges(base);
  return base.map((row) => {
    const out = computeScore(row, ranges);
    return {
      ...row,
      score: out.score,
      scoreBreakdown: out.breakdown,
      scoreWeightSum: out.weightSum,
      scoreRanges: ranges, // opcional (por si lo quieres mostrar más adelante)
    };
  });
}

function sortRows(rows) {
  const { key, dir } = sortState;
  const factor = dir === 'asc' ? 1 : -1;

  return [...rows].sort((a, b) => {
    const va = a[key];
    const vb = b[key];

    const aNum = typeof va === 'number' && !Number.isNaN(va);
    const bNum = typeof vb === 'number' && !Number.isNaN(vb);

    if (aNum && bNum) return (va - vb) * factor;
    if (aNum && !bNum) return -1;
    if (!aNum && bNum) return 1;

    const sa = (va ?? '').toString().toLowerCase();
    const sb = (vb ?? '').toString().toLowerCase();
    if (sa < sb) return -1 * factor;
    if (sa > sb) return 1 * factor;
    return 0;
  });
}

// ✅ Mejor + peor por columna (excluye groceriesPerPerson)
function computeBestWorstMap(rows) {
  const rules = {
    distanceKm: { best: 'min', worst: 'max' },
    kmTotal: { best: 'max', worst: 'min' },
    openKm: { best: 'max', worst: 'min' },
    vibeScore: { best: 'max', worst: 'min' },
    apresScore: { best: 'max', worst: 'min' },
    tripPerPerson: { best: 'min', worst: 'max' },
    // groceriesPerPerson: EXCLUIDA a propósito
    rentalPerPerson: { best: 'min', worst: 'max' },
    hotelForfaitPerPerson: { best: 'min', worst: 'max' },
    totalPerPerson: { best: 'min', worst: 'max' },
    score: { best: 'max', worst: 'min' },
  };

  const map = {};

  for (const [key, mode] of Object.entries(rules)) {
    const vals = rows.map((r) => r[key]).filter((v) => typeof v === 'number' && !Number.isNaN(v));
    if (!vals.length) continue;

    const min = Math.min(...vals);
    const max = Math.max(...vals);

    // Si todos iguales -> no pintamos nada en esa columna
    if (min === max) continue;

    map[key] = {
      bestValue: mode.best === 'min' ? min : max,
      worstValue: mode.worst === 'min' ? min : max,
    };
  }

  return map;
}

function almostEqual(a, b) {
  if (a == null || b == null) return false;
  return Math.abs(a - b) < 1e-9;
}

// Render tabla
function renderRows(rows) {
  const tbody = $('resultsTbody');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 13;
    td.textContent = 'No hay estaciones dentro del rango.';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  const bw = computeBestWorstMap(rows);

  const bestScore = Math.max(...rows.map((r) => r.score).filter((v) => typeof v === 'number'));

  for (const r of rows) {
    const tr = document.createElement('tr');
    if (almostEqual(r.score, bestScore)) {
      tr.classList.add('winner');
    }

    tr.appendChild(tdResortClickable(r.id, r.name));
    tr.appendChild(tdText(`${r.country ?? ''} · ${r.region ?? ''}`.trim()));

    tr.appendChild(
      tdMetric(
        `${r.distanceKm != null ? r.distanceKm.toFixed(0) : '—'} km`,
        r.distanceKm,
        bw.distanceKm
      )
    );
    tr.appendChild(tdMetric(r.kmTotal != null ? String(r.kmTotal) : '—', r.kmTotal, bw.kmTotal));
    tr.appendChild(tdOpenKm(r.id, r.name, r.openKm, bw.openKm));
    tr.appendChild(
      tdMetric(r.vibeScore != null ? String(r.vibeScore) : '—', r.vibeScore, bw.vibeScore)
    );
    tr.appendChild(
      tdMetric(r.apresScore != null ? String(r.apresScore) : '—', r.apresScore, bw.apresScore)
    );

    tr.appendChild(tdRightMetric(euro(r.tripPerPerson), r.tripPerPerson, bw.tripPerPerson));

    // ✅ Compra: sin best/worst (nunca)
    tr.appendChild(tdRightPlain(euro(r.groceriesPerPerson)));

    tr.appendChild(
      tdRightMetric(
        r.rentalPerPerson == null ? '—' : euro(r.rentalPerPerson),
        r.rentalPerPerson,
        bw.rentalPerPerson
      )
    );
    tr.appendChild(
      tdRightMetric(
        r.hotelForfaitPerPerson == null ? '—' : euro(r.hotelForfaitPerPerson),
        r.hotelForfaitPerPerson,
        bw.hotelForfaitPerPerson
      )
    );
    tr.appendChild(tdRightMetric(euro(r.totalPerPerson), r.totalPerPerson, bw.totalPerPerson));
    tr.appendChild(tdScoreClickable(r.id, r.name, r.score, bw.score));

    tbody.appendChild(tr);
  }
}

// Celdas con best/worst (izquierda)
function tdMetric(text, value, bwEntry) {
  const td = document.createElement('td');
  td.textContent = text;

  if (bwEntry && typeof value === 'number' && !Number.isNaN(value)) {
    if (almostEqual(value, bwEntry.bestValue)) td.classList.add('best');
    if (almostEqual(value, bwEntry.worstValue)) td.classList.add('worst');
  }

  return td;
}

function tdOpenKm(resortId, resortName, openKm, bwEntry) {
  const td = document.createElement('td');

  const wrap = document.createElement('span');
  wrap.className = 'kmCell openKmLink';
  wrap.setAttribute('data-open-openkm-history', '1');
  wrap.setAttribute('data-resort-id', resortId);
  wrap.setAttribute('data-resort-name', resortName);

  const main = document.createElement('span');
  main.textContent = openKm != null ? String(openKm) : '—';
  wrap.appendChild(main);

  // delta vs ayer (superíndice)
  const dObj = window.openKmDeltaByResortId?.[resortId];
  if (dObj && typeof dObj.delta === 'number' && Number.isFinite(dObj.delta)) {
    const sup = document.createElement('span');
    const cls = dObj.delta > 0 ? 'up' : dObj.delta < 0 ? 'down' : 'flat';
    sup.className = `kmDeltaSup ${cls}`;

    const deltaTxt = dObj.delta > 0 ? `+${dObj.delta}` : `${dObj.delta}`;

    let pctTxt = '';
    if (typeof dObj.pct === 'number' && Number.isFinite(dObj.pct)) {
      const rounded = Math.round(dObj.pct); // o 1 decimal si prefieres
      const sign = rounded > 0 ? '+' : '';
      pctTxt = ` (${sign}${rounded}%)`;
    }

    sup.textContent = `${deltaTxt}${pctTxt}`;
    wrap.appendChild(sup);
  }

  td.appendChild(wrap);

  // best/worst por valor openKm
  if (bwEntry && typeof openKm === 'number' && !Number.isNaN(openKm)) {
    if (almostEqual(openKm, bwEntry.bestValue)) td.classList.add('best');
    if (almostEqual(openKm, bwEntry.worstValue)) td.classList.add('worst');
  }

  return td;
}

// Celdas con best/worst (derecha)
function tdRightMetric(text, value, bwEntry) {
  const td = document.createElement('td');
  td.textContent = text;
  td.style.textAlign = 'right';
  td.style.whiteSpace = 'nowrap';

  if (bwEntry && typeof value === 'number' && !Number.isNaN(value)) {
    if (almostEqual(value, bwEntry.bestValue)) td.classList.add('best');
    if (almostEqual(value, bwEntry.worstValue)) td.classList.add('worst');
  }

  return td;
}

function tdScoreClickable(resortId, resortName, score, bwEntry) {
  const td = document.createElement('td');
  td.style.textAlign = 'right';
  td.style.whiteSpace = 'nowrap';

  const wrap = document.createElement('span');
  wrap.className = 'scoreLink';
  wrap.setAttribute('data-open-score-breakdown', '1');
  wrap.setAttribute('data-resort-id', resortId);
  wrap.setAttribute('data-resort-name', resortName);

  wrap.textContent = score == null ? '—' : `${round2(score).toFixed(1)}`;
  td.appendChild(wrap);

  if (bwEntry && typeof score === 'number' && !Number.isNaN(score)) {
    if (almostEqual(score, bwEntry.bestValue)) td.classList.add('best');
    if (almostEqual(score, bwEntry.worstValue)) td.classList.add('worst');
  }

  return td;
}

function fmtRawValue(key, raw) {
  if (raw == null || Number.isNaN(raw)) return '—';
  if (key === 'total' || key === 'hotelForfait' || key === 'rental') return euro(raw);
  if (key === 'distance') return `${Math.round(raw)} km`;
  if (key === 'kmTotal' || key === 'openKm') return `${Math.round(raw)}`;
  return String(raw);
}

window.openScoreBreakdownForResort = function openScoreBreakdownForResort(resortId, resortName) {
  const view = $('scoreBreakdownView');
  const tbody = $('scoreBreakdownTbody');
  const title = $('scoreBreakdownTitle');
  const meta = $('scoreBreakdownMeta');
  if (!view || !tbody) return;

  const row = (currentRows || []).find((r) => r.id === resortId);
  if (!row) return;

  title.textContent = `🧮 Desglose de puntuación · ${resortName}`;
  meta.textContent =
    row.score == null
      ? 'No hay suficiente información para calcular la puntuación.'
      : `Puntuación final: ${round2(row.score).toFixed(1)} / 100`;

  // ✅ Contexto extra para “Km abiertos” (último registro + delta)
  const dObj = window.openKmDeltaByResortId?.[resortId];
  if (dObj && typeof row.openKm === 'number' && Number.isFinite(row.openKm)) {
    const sign = (dObj.delta ?? 0) > 0 ? '+' : '';
    const deltaTxt =
      typeof dObj.delta === 'number' && Number.isFinite(dObj.delta) ? `${sign}${dObj.delta}` : '—';

    meta.textContent += ` · Km abiertos (último): ${Math.round(row.openKm)} · Δ vs ayer: ${deltaTxt}`;
  }

  tbody.innerHTML = '';

  const items = Array.isArray(row.scoreBreakdown) ? row.scoreBreakdown : [];
  if (!items.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.textContent = 'Sin desglose disponible.';
    tr.appendChild(td);
    tbody.appendChild(tr);
    view.classList.remove('hidden');
    return;
  }

  // Orden: contribución mayor primero (más útil para entender el score)
  const sorted = [...items].sort((a, b) => (b.contrib100 ?? 0) - (a.contrib100 ?? 0));

  for (const it of sorted) {
    const tr = document.createElement('tr');

    const tdLabel = document.createElement('td');
    tdLabel.textContent = it.label || it.key;

    const tdRaw = document.createElement('td');
    tdRaw.className = 'right';

    let rawTxt = fmtRawValue(it.key, it.raw);

    // ✅ Si es “Km abiertos”, añadimos delta del histórico (si existe)
    if (it.key === 'openKm') {
      const dObj = window.openKmDeltaByResortId?.[resortId];
      if (dObj && typeof dObj.delta === 'number' && Number.isFinite(dObj.delta)) {
        const sign = dObj.delta > 0 ? '+' : '';
        rawTxt = `${rawTxt} (${sign}${dObj.delta})`;
      }
    }

    tdRaw.textContent = rawTxt;

    const tdNorm = document.createElement('td');
    tdNorm.className = 'right';
    tdNorm.textContent =
      typeof it.norm === 'number' && Number.isFinite(it.norm) ? it.norm.toFixed(3) : '—';

    const tdW = document.createElement('td');
    tdW.className = 'right';
    tdW.textContent =
      typeof it.weight === 'number' && Number.isFinite(it.weight) ? it.weight.toFixed(2) : '—';

    const tdC = document.createElement('td');
    tdC.className = 'right';
    tdC.textContent =
      typeof it.contrib100 === 'number' && Number.isFinite(it.contrib100)
        ? it.contrib100.toFixed(1)
        : '—';

    tr.appendChild(tdLabel);
    tr.appendChild(tdRaw);
    tr.appendChild(tdNorm);
    tr.appendChild(tdW);
    tr.appendChild(tdC);
    tbody.appendChild(tr);
  }

  view.classList.remove('hidden');
};

// Celdas derecha sin colores (para Compra)
function tdRightPlain(text) {
  const td = document.createElement('td');
  td.textContent = text;
  td.style.textAlign = 'right';
  td.style.whiteSpace = 'nowrap';
  return td;
}

function tdText(text) {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

function tdResortClickable(resortId, resortName) {
  const td = document.createElement('td');

  const a = document.createElement('span');
  a.className = 'resortLink';
  a.setAttribute('data-open-resort-comments', '1');
  a.setAttribute('data-resort-id', resortId);
  a.setAttribute('data-resort-name', resortName);

  // Nombre
  const nameSpan = document.createElement('span');
  nameSpan.textContent = resortName;
  a.appendChild(nameSpan);

  const histBtn = document.createElement('button');
  histBtn.className = 'linkBtn';
  histBtn.type = 'button';
  histBtn.textContent = ' 📈';
  histBtn.setAttribute('data-open-price-history', '1');
  histBtn.setAttribute('data-resort-id', resortId);
  histBtn.setAttribute('data-resort-name', resortName);
  a.appendChild(histBtn);

  // Badge (si hay comentarios)
  const count = Number(window.commentsCountMap?.[resortId] ?? 0);
  if (count > 0) {
    const badge = document.createElement('span');
    badge.className = 'commentBadge';
    badge.textContent = `📝 ${count}`;
    a.appendChild(badge);
  }

  td.appendChild(a);
  return td;
}

// Geolocalización
async function getMyLocation() {
  setStatus('Pidiendo permiso de ubicación…');
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocalización no soportada por tu navegador.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: false, timeout: 8000 }
    );
  });
}

// Inicializar UI
function initOriginSelect() {
  const sel = $('originSelect');
  if (!sel) return;

  if (sel.options.length > 0) return;

  for (const [key, o] of Object.entries(ORIGINS)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = o.label;
    sel.appendChild(opt);
  }

  sel.value = 'tarragona';
}

// Ejecutar filtro + render
function applyFilter() {
  const originKey = $('originSelect')?.value || 'tarragona';
  const origin = customOrigin ?? ORIGINS[originKey] ?? ORIGINS.tarragona;

  const maxKm = Number($('maxKm')?.value || 400);

  if (!origin || typeof origin.lat !== 'number' || typeof origin.lon !== 'number') {
    setStatus('Origen inválido.');
    return;
  }

  const filtered = filterResortsByRadius(cachedResorts, origin, maxKm, originKey);
  const tripCfg = readTripConfig();
  updateGroceriesSummary(tripCfg.tripDays, tripCfg.numPeople);

  setStatus(
    `Origen: ${customOrigin ? 'Mi ubicación' : (ORIGINS[originKey]?.label ?? 'Tarragona')} · Máx: ${maxKm} km · Resultados: ${filtered.length}`
  );

  currentRows = buildRows(filtered, tripCfg);
  currentRows = sortRows(currentRows);
  renderRows(currentRows);
}

function setActiveSeg(btnId) {
  ['topScoreBtn', 'topCheapBtn', 'topNearBtn'].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.classList.toggle('isActive', id === btnId);
  });
}

function showTopBy(key, dir = 'desc') {
  sortState.key = key;
  sortState.dir = dir;
  const sorted = sortRows(currentRows);
  renderRows(sorted.slice(0, 5));
}

// Boot
async function main() {
  try {
    setStatus('Cargando estaciones…');
    initOriginSelect();

    cachedResorts = await loadResorts();
    window.cachedResorts = cachedResorts; // ✅ expone para otros módulos
    await loadCommentsCount();
    await window.initOpenKmHistory?.();
    console.log('[app.js] after await loadCommentsCount:', window.commentsCountMap);
    const validCount = cachedResorts.filter(hasValidLocation).length;
    setStatus(`Estaciones cargadas: ${cachedResorts.length} (coords válidas: ${validCount}).`);

    $('applyFilterBtn')?.addEventListener('click', applyFilter);
    $('openGroceriesBtn')?.addEventListener('click', () => {
      const cfg = readTripConfig();
      window.renderGroceriesView?.(cfg.tripDays, cfg.numPeople);
      $('groceriesView')?.classList.remove('hidden');
    });
    $('closeGroceriesBtn')?.addEventListener('click', () => {
      $('groceriesView')?.classList.add('hidden');
    });
    $('closeCommentsBtn')?.addEventListener('click', () => {
      $('commentsView')?.classList.add('hidden');
    });

    $('closeGroceriesBtnX')?.addEventListener('click', () => {
      $('groceriesView')?.classList.add('hidden');
    });
    $('closeCommentsBtnX')?.addEventListener('click', () => {
      $('commentsView')?.classList.add('hidden');
    });
    $('closePriceHistoryBtn')?.addEventListener('click', () => {
      $('priceHistoryView')?.classList.add('hidden');
    });
    $('closePriceHistoryBtnX')?.addEventListener('click', () => {
      $('priceHistoryView')?.classList.add('hidden');
    });
    $('priceInsightsBtn')?.addEventListener('click', () => {
      window.openPriceInsights?.();
    });

    $('closePriceInsightsBtn')?.addEventListener('click', () => {
      $('priceInsightsView')?.classList.add('hidden');
    });
    $('closePriceInsightsBtnX')?.addEventListener('click', () => {
      $('priceInsightsView')?.classList.add('hidden');
    });
    $('closeOpenKmHistoryBtn')?.addEventListener('click', () => {
      $('openKmHistoryView')?.classList.add('hidden');
    });
    $('closeOpenKmHistoryBtnX')?.addEventListener('click', () => {
      $('openKmHistoryView')?.classList.add('hidden');
    });

    $('closeScoreBreakdownBtn')?.addEventListener('click', () => {
      $('scoreBreakdownView')?.classList.add('hidden');
    });
    $('closeScoreBreakdownBtnX')?.addEventListener('click', () => {
      $('scoreBreakdownView')?.classList.add('hidden');
    });

    // ✅ Cerrar modal al hacer click fuera de la tarjeta
    $('groceriesView')?.addEventListener('click', (e) => {
      if (e.target?.id === 'groceriesView') $('groceriesView')?.classList.add('hidden');
    });
    $('commentsView')?.addEventListener('click', (e) => {
      if (e.target?.id === 'commentsView') $('commentsView')?.classList.add('hidden');
    });
    $('priceHistoryView')?.addEventListener('click', (e) => {
      if (e.target?.id === 'priceHistoryView') $('priceHistoryView')?.classList.add('hidden');
    });
    $('priceInsightsView')?.addEventListener('click', (e) => {
      if (e.target?.id === 'priceInsightsView') $('priceInsightsView')?.classList.add('hidden');
    });
    $('openKmHistoryView')?.addEventListener('click', (e) => {
      if (e.target?.id === 'openKmHistoryView') $('openKmHistoryView')?.classList.add('hidden');
    });
    $('scoreBreakdownView')?.addEventListener('click', (e) => {
      if (e.target?.id === 'scoreBreakdownView') $('scoreBreakdownView')?.classList.add('hidden');
    });

    // ✅ Escape para cerrar modales
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      $('groceriesView')?.classList.add('hidden');
      $('commentsView')?.classList.add('hidden');
      $('priceHistoryView')?.classList.add('hidden');
      $('priceInsightsView')?.classList.add('hidden');
      $('openKmHistoryView')?.classList.add('hidden');
      $('scoreBreakdownView')?.classList.add('hidden');
      $('availabilityView')?.classList.add('hidden');
      $('skierPhotoView')?.classList.add('hidden');
    });

    $('openCommentsBtn')?.addEventListener('click', () => {
      // Si no hay estación seleccionada, abrimos el modal en “modo ayuda”
      window.openCommentsModalForResort?.(
        'global',
        'Selecciona una estación (haz click en su nombre)'
      );
    });

    $('recalcBtn')?.addEventListener('click', applyFilter);

    $('resultsTbody')?.addEventListener('click', (e) => {
      const hist = e.target.closest('[data-open-price-history]');
      if (hist) {
        const resortId = hist.getAttribute('data-resort-id');
        const resortName = hist.getAttribute('data-resort-name') || 'Estación';
        window.openPriceHistoryForResort?.(resortId, resortName);
        return;
      }

      const okm = e.target.closest('[data-open-openkm-history]');
      if (okm) {
        const resortId = okm.getAttribute('data-resort-id');
        const resortName = okm.getAttribute('data-resort-name') || 'Estación';
        window.openOpenKmHistoryForResort?.(resortId, resortName);
        return;
      }

      const sb = e.target.closest('[data-open-score-breakdown]');
      if (sb) {
        const resortId = sb.getAttribute('data-resort-id');
        const resortName = sb.getAttribute('data-resort-name') || 'Estación';
        window.openScoreBreakdownForResort?.(resortId, resortName);
        return;
      }

      const btn = e.target.closest('[data-open-resort-comments]');
      if (!btn) return;

      const resortId = btn.getAttribute('data-resort-id');
      const resortName = btn.getAttribute('data-resort-name') || 'Estación';
      window.openCommentsModalForResort?.(resortId, resortName);
    });

    // ✅ Ordenación al clickar cabeceras
    document.querySelectorAll('th[data-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.getAttribute('data-sort');

        if (sortState.key === key) {
          sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
        } else {
          sortState.key = key;
          sortState.dir = key === 'score' ? 'desc' : 'asc';
        }

        // UI: limpiar estados
        document.querySelectorAll('th').forEach((h) => {
          h.classList.remove('sorted', 'asc', 'desc');
        });

        th.classList.add('sorted', sortState.dir);

        if (currentRows?.length) {
          const sorted = sortRows(currentRows);
          renderRows(sorted);
        }
      });
    });

    // Auto recalcular al cambiar inputs clave
    [
      'maxKm',
      'numPeople',
      'numCars',
      'fuelConsumption',
      'fuelPrice',
      'tollsTotal',
      'parkingPerDay',
      'parkingDays',
      'skiDays',
      'nights',
      'tripDate',
      'originSelect',
    ].forEach((id) => $(id)?.addEventListener('change', applyFilter));

    $('useMyLocationBtn')?.addEventListener('click', async () => {
      try {
        customOrigin = await getMyLocation();
        setStatus('Ubicación detectada ✅ Recalculando…');
        applyFilter();
      } catch (e) {
        customOrigin = null;
        setStatus('No pude obtener tu ubicación. Revisa permisos del navegador.');
      }
    });
    $('updateDataBtn')?.addEventListener('click', () => {
      // Opción A: abrir la página del workflow para pulsar “Run workflow”
      // Cambia OWNER/REPO por el tuyo y el nombre del workflow si difiere
      const OWNER = 'Lilru-tech';
      const REPO = 'skitrip';
      const WF = 'update-data.yml';

      const url = `https://github.com/${OWNER}/${REPO}/actions/workflows/${WF}`;
      window.open(url, '_blank');
      $('updateHint').textContent = 'Se abrirá GitHub → Actions. Pulsa “Run workflow”.';
    });
    $('topScoreBtn')?.addEventListener('click', () => {
      setActiveSeg('topScoreBtn');
      showTopBy('score', 'desc');
    });
    $('topCheapBtn')?.addEventListener('click', () => {
      setActiveSeg('topCheapBtn');
      showTopBy('totalPerPerson', 'asc');
    });
    $('topNearBtn')?.addEventListener('click', () => {
      setActiveSeg('topNearBtn');
      showTopBy('distanceKm', 'asc');
    });

    // ✅ Drag-to-scroll horizontal (iOS friendly)
    const scroller = document.querySelector('.tableScrollX');
    if (scroller) {
      let isDown = false;
      let startX = 0;
      let startScrollLeft = 0;

      scroller.addEventListener(
        'touchstart',
        (e) => {
          isDown = true;
          startX = e.touches[0].pageX;
          startScrollLeft = scroller.scrollLeft;
        },
        { passive: true }
      );

      scroller.addEventListener(
        'touchmove',
        (e) => {
          if (!isDown) return;
          const x = e.touches[0].pageX;
          scroller.scrollLeft = startScrollLeft - (x - startX);
        },
        { passive: true }
      );

      scroller.addEventListener(
        'touchend',
        () => {
          isDown = false;
        },
        { passive: true }
      );
    }

    applyFilter();
  } catch (e) {
    console.error(e);
    setStatus(`Error: ${e.message}`);
  }

  // ------------------------------
// Modal foto esquiador
// ------------------------------
(function wireSkierPhotoModal() {
  const openBtn = document.getElementById('openSkierPhotoBtn');
  const view = document.getElementById('skierPhotoView');
  const closeBtn = document.getElementById('closeSkierPhotoBtn');
  const closeBtnX = document.getElementById('closeSkierPhotoBtnX');

  if (!openBtn || !view) return;
  console.log('[skier modal] wired ✅', { openBtn, view });
  const open = () => {
    console.log('[skier modal] open click ✅');
    view.classList.remove('hidden');
  };
  const close = () => view.classList.add('hidden');

  openBtn.addEventListener('click', open);
  closeBtn?.addEventListener('click', close);
  closeBtnX?.addEventListener('click', close);

  // Click fuera para cerrar
  view.addEventListener('click', (e) => {
    if (e.target?.id === 'skierPhotoView') close();
  });
})();

}

document.addEventListener('DOMContentLoaded', main);