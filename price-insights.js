"use strict";

const PRICE_INSIGHTS_HISTORY_URL = "./data/hotel_price_history.json";

// ✅ cache global para reutilizar en price-history.js
window.__priceInsightsCache = null;

function resortNameFromId(id) {
  // intenta mapearlo usando resorts.json si ya está cargado en app.js (cachedResorts)
  // fallback: devuelve el id
  const list = window.cachedResorts || window.__cachedResorts || null;
  if (Array.isArray(list)) {
    const r = list.find(x => x.id === id);
    if (r?.name) return r.name;
  }
  return id;
}

function heatClassForDropRate(pct) {
  if (pct == null) return "";
  if (pct >= 35) return "heatGood";
  if (pct >= 20) return "heatMid";
  return "heatBad";
}

function heatClassForPctDrop(pct) {
  if (pct == null) return "";
  if (pct >= 6) return "heatGood";
  if (pct >= 3) return "heatMid";
  return "heatBad";
}

function heatClassForVolatility(eur) {
  if (eur == null) return "";
  if (eur <= 1.0) return "heatGood";
  if (eur <= 2.5) return "heatMid";
  return "heatBad";
}

async function loadPriceHistoryItems() {
    const res = await fetch(`${PRICE_INSIGHTS_HISTORY_URL}?v=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error("No se pudo cargar hotel_price_history.json");
  const data = await res.json();
  return Array.isArray(data.items) ? data.items : [];
}

function euroNum(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return `${Number(n).toFixed(2)} €`;
}

function weekdayLabel(dow) {
  // JS: 0=Dom ... 6=Sáb
  const map = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  return map[dow] || "—";
}

function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

// Construye deltas por resort ordenando por fecha (YYYY-MM-DD)
function buildResortDailySeries(items) {
  const byResort = new Map();

  for (const it of items) {
    if (!it?.resortId || !it?.date) continue;
    const cheapest = safeNum(it.cheapestUnit);
    const top10 = safeNum(it.top10AvgUnit);

    if (cheapest == null && top10 == null) continue;

    if (!byResort.has(it.resortId)) byResort.set(it.resortId, []);
    byResort.get(it.resortId).push({
      date: it.date,
      ts: it.ts,
      cheapest,
      top10
    });
  }

  // Orden asc por date
  for (const [rid, arr] of byResort.entries()) {
    arr.sort((a, b) => (a.date === b.date ? 0 : (a.date < b.date ? -1 : 1)));
  }

  return byResort;
}

function mean(arr) {
  if (!arr.length) return null;
  const s = arr.reduce((acc, v) => acc + v, 0);
  return s / arr.length;
}

window.openPriceInsights = async () => {
  const meta = document.getElementById("priceInsightsMeta");
  const tbody = document.getElementById("priceInsightsTbody");
  const chips = document.getElementById("priceInsightsChips");
  const rankingsEl = document.getElementById("priceInsightsRankings");
if (rankingsEl) rankingsEl.innerHTML = "";

  document.getElementById("priceInsightsView")?.classList.remove("hidden");
  meta.textContent = "Cargando…";
  tbody.innerHTML = "";
  chips.innerHTML = "";

  try {
    const items = await loadPriceHistoryItems();
    if (!items.length) {
      meta.textContent = "No hay histórico aún. Ejecuta el update para generar datos.";
      return;
    }

    const byResort = buildResortDailySeries(items);

    // Aggregación por día de la semana
    // Guardamos: cheapest values, top10 values, dropCount, comparableCount, absDelta list
    const byDow = new Map(); // dow -> stats
    for (let dow = 0; dow < 7; dow++) {
        byDow.set(dow, { cheapest: [], top10: [], drop: 0, comparable: 0, absDelta: [], pctDrops: [] });
    }

    // Para “resorts más volátiles”
    const resortAbsDeltas = new Map(); // resortId -> absDelta[]

    for (const [rid, series] of byResort.entries()) {
      for (let i = 0; i < series.length; i++) {
        const curr = series[i];
        const d = new Date(curr.date + "T00:00:00");
        if (Number.isNaN(d.getTime())) continue;

        const dow = d.getDay();
        const bucket = byDow.get(dow);

        if (curr.cheapest != null) bucket.cheapest.push(curr.cheapest);
        if (curr.top10 != null) bucket.top10.push(curr.top10);

        // delta vs día anterior (si existe)
        const prev = series[i - 1];
        if (prev && curr.cheapest != null && prev.cheapest != null) {
            const diff = curr.cheapest - prev.cheapest;
            bucket.comparable += 1;
          
            if (diff < -0.00001) {
              bucket.drop += 1;
          
              // ✅ magnitud real: % de bajada vs día anterior (solo cuando baja)
              const pct = prev.cheapest === 0 ? null : ((prev.cheapest - curr.cheapest) / prev.cheapest) * 100;
              if (pct != null && Number.isFinite(pct)) bucket.pctDrops.push(pct);
            }
          
            bucket.absDelta.push(Math.abs(diff));
          
            if (!resortAbsDeltas.has(rid)) resortAbsDeltas.set(rid, []);
            resortAbsDeltas.get(rid).push(Math.abs(diff));
          }
      }
    }

    // Generar filas (Lunes..Domingo orden “humano”)
    const order = [1,2,3,4,5,6,0]; // L..D
    const rows = order.map(dow => {
      const s = byDow.get(dow);
      const avgCheapest = mean(s.cheapest);
      const avgTop10 = mean(s.top10);
      const dropRate = s.comparable ? (s.drop / s.comparable) * 100 : null; // probabilidad
      const avgPctDrop = mean(s.pctDrops); // magnitud media cuando baja
      const avgAbsDelta = mean(s.absDelta);
      
      return {
        dow,
        day: weekdayLabel(dow),
        avgCheapest,
        avgTop10,
        dropRate,
        avgPctDrop,
        avgAbsDelta,
        samples: s.cheapest.length,
        comparable: s.comparable,
        drop: s.drop
      };
    });

    // “Mejor día para comprar”: el de menor avgCheapest (si hay)
    const validCheapest = rows.filter(r => r.avgCheapest != null);
    const bestByCheapest = validCheapest.sort((a,b) => a.avgCheapest - b.avgCheapest)[0] || null;

    // “Día con más probabilidad de bajar”
    const validDrop = rows.filter(r => r.dropRate != null);
    const bestDrop = validDrop.sort((a,b) => b.dropRate - a.dropRate)[0] || null;

    // “Resort más volátil” (por media abs delta)
    let mostVolatileResort = null;
    for (const [rid, deltas] of resortAbsDeltas.entries()) {
      const m = mean(deltas);
      if (m == null) continue;
      if (!mostVolatileResort || m > mostVolatileResort.m) {
        mostVolatileResort = { rid, m };
      }
    }

    // ✅ Ranking: media de volatilidad por resort (abs delta)
const resortVol = [];
for (const [rid, deltas] of resortAbsDeltas.entries()) {
  const m = mean(deltas);
  if (m == null) continue;
  resortVol.push({ rid, m });
}
resortVol.sort((a,b) => a.m - b.m);

const topStable = resortVol.slice(0, 5);
const topVolatile = [...resortVol].reverse().slice(0, 5);

function renderRankCard(title, items, fmtValue) {
  if (!rankingsEl) return;

  const card = document.createElement("div");
  card.className = "rankCard";

  const h = document.createElement("div");
  h.className = "rankTitle";
  h.textContent = title;
  card.appendChild(h);

  const list = document.createElement("div");
  list.className = "rankList";

  items.forEach((it, idx) => {
    const row = document.createElement("div");
    row.className = "rankItem";

    const left = document.createElement("div");
    left.className = "left";

    const badge = document.createElement("span");
    badge.className = "rankBadge";
    badge.textContent = `#${idx + 1}`;
    left.appendChild(badge);

    const name = document.createElement("span");
    name.className = "rankName";
    name.textContent = resortNameFromId(it.rid);
    left.appendChild(name);

    const value = document.createElement("span");
    value.className = "rankValue";
    value.textContent = fmtValue(it);

    row.appendChild(left);
    row.appendChild(value);

    list.appendChild(row);
  });

  card.appendChild(list);
  rankingsEl.appendChild(card);
}

renderRankCard("🟢 Más estables (menor volatilidad)", topStable, (it) => `Δ ${euroNum(it.m)}`);
renderRankCard("🔴 Más volátiles (mayor volatilidad)", topVolatile, (it) => `Δ ${euroNum(it.m)}`);

    // Chips resumen
    const chip = (text) => {
      const el = document.createElement("div");
      el.className = "chip";
      el.textContent = text;
      chips.appendChild(el);
    };

    chip(`Resorts analizados: ${byResort.size}`);
    chip(`Registros totales: ${items.length}`);

    if (bestByCheapest) chip(`Mejor día (cheapest): ${bestByCheapest.day} · ${euroNum(bestByCheapest.avgCheapest)}`);
    if (bestDrop) chip(`Más “baja” (cheapest): ${bestDrop.day} · ${bestDrop.dropRate.toFixed(0)}%`);

    if (mostVolatileResort) chip(`Más volátil: ${mostVolatileResort.rid} · Δ medio ${euroNum(mostVolatileResort.m)}`);

    // Meta
    meta.textContent = "Basado en cheapestUnit y top10AvgUnit. Prob. bajar = % de veces que baja vs día anterior (por resort). % bajada media = magnitud media cuando baja.";

    // Pintar tabla
    for (const r of rows) {
      const tr = document.createElement("tr");

      const tdDay = document.createElement("td");
      tdDay.textContent = r.day;

      const tdC = document.createElement("td");
      tdC.className = "right";
      tdC.textContent = r.avgCheapest == null ? "—" : euroNum(r.avgCheapest);

      const tdA = document.createElement("td");
      tdA.className = "right";
      tdA.textContent = r.avgTop10 == null ? "—" : euroNum(r.avgTop10);

      const tdDrop = document.createElement("td");
      tdDrop.className = "right";
      tdDrop.textContent = r.dropRate == null ? "—" : `${r.dropRate.toFixed(0)}%`;
      const clsDrop = heatClassForDropRate(r.dropRate);
      if (clsDrop) tdDrop.classList.add(clsDrop);
      
      // ✅ NUEVA COLUMNA: % bajada media cuando baja
      const tdPctDrop = document.createElement("td");
      tdPctDrop.className = "right";
      tdPctDrop.textContent = r.avgPctDrop == null ? "—" : `${r.avgPctDrop.toFixed(1)}%`;
      const clsPct = heatClassForPctDrop(r.avgPctDrop);
      if (clsPct) tdPctDrop.classList.add(clsPct);
      
      const tdAbs = document.createElement("td");
      tdAbs.className = "right";
      tdAbs.textContent = r.avgAbsDelta == null ? "—" : euroNum(r.avgAbsDelta);
      const clsVol = heatClassForVolatility(r.avgAbsDelta);
      if (clsVol) tdAbs.classList.add(clsVol);

      const tdN = document.createElement("td");
      tdN.className = "right";
      tdN.textContent = String(r.samples);

      tr.appendChild(tdDay);
      tr.appendChild(tdC);
      tr.appendChild(tdA);
      tr.appendChild(tdDrop);
      tr.appendChild(tdPctDrop);
      tr.appendChild(tdAbs);
      tr.appendChild(tdN);

      tbody.appendChild(tr);
    }
    // ✅ Guardamos cache global para que el histórico lo use sin recalcular todo
window.__priceInsightsCache = {
    byResort,        // series por resort (para stats por resort)
    byDow,           // stats por día
    rows,            // filas agregadas ya calculadas
    resortVol        // volatilidad por resort
  };
  } catch (e) {
    meta.textContent = `Error: ${e.message}`;
  }
};