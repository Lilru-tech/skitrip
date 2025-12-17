"use strict";

const PRICE_HISTORY_URL = "./data/hotel_price_history.json";

async function loadPriceHistory() {
  const res = await fetch(`${PRICE_HISTORY_URL}?v=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error("No se pudo cargar hotel_price_history.json");
  const data = await res.json();
  return Array.isArray(data.items) ? data.items : [];
}

function euroNum(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return `${Number(n).toFixed(2)} €`;
}

window.openPriceHistoryForResort = async (resortId, resortName) => {
  const title = document.getElementById("priceHistoryTitle");
  const meta = document.getElementById("priceHistoryMeta");
  const tbody = document.getElementById("priceHistoryTbody");

  title.textContent = `📈 Histórico hotel · ${resortName}`;
  meta.textContent = "Cargando…";
  tbody.innerHTML = "";

  document.getElementById("priceHistoryView")?.classList.remove("hidden");

  try {
    const items = await loadPriceHistory();
    const rows = items
    .filter(it => it.resortId === resortId)
    .sort((a, b) => (a.ts === b.ts ? 0 : (a.ts < b.ts ? 1 : -1)));
  
  meta.textContent = rows.length
    ? `${rows.length} registros`
    : "Sin histórico aún (ejecuta el update para generarlo)";
    
    if (!rows.length) return;

    function deltaInfo(curr, prev) {
      const c = Number(curr);
      const p = Number(prev);
    
      if (!Number.isFinite(c) || !Number.isFinite(p)) return null;
    
      const diff = c - p; // >0 sube, <0 baja
      const pct = p === 0 ? null : (diff / p) * 100;
    
      let cls = "flat";
      if (diff > 0.00001) cls = "up";
      else if (diff < -0.00001) cls = "down";
    
      return { diff, pct, cls };
    }
    
    function fmtEuroDiff(diff) {
      const sign = diff > 0 ? "+" : "";
      return `${sign}${diff.toFixed(2)} €`;
    }
    
    function fmtPct(pct) {
      if (pct == null || !Number.isFinite(pct)) return "—";
      const sign = pct > 0 ? "+" : "";
      return `${sign}${pct.toFixed(1)}%`;
    }

    for (let i = 0; i < rows.length; i++) {
      const it = rows[i];
      const prevIt = rows[i + 1] || null; // el “anterior en el tiempo” (más viejo)
    
      const tr = document.createElement("tr");
    
      const tdDate = document.createElement("td");
      tdDate.textContent = it.date;
    
      const tdCheapest = document.createElement("td");
      tdCheapest.className = "right";
      tdCheapest.textContent = euroNum(it.cheapestUnit);
    
      // ✅ Cambio cheapest
      const tdCheapestDelta = document.createElement("td");
      tdCheapestDelta.className = "right";
      if (prevIt) {
        const d = deltaInfo(it.cheapestUnit, prevIt.cheapestUnit);
        if (d) {
          const span = document.createElement("span");
          span.className = `delta ${d.cls}`;
          span.textContent = `${fmtEuroDiff(d.diff)} (${fmtPct(d.pct)})`;
          tdCheapestDelta.appendChild(span);
        } else {
          tdCheapestDelta.textContent = "—";
        }
      } else {
        tdCheapestDelta.textContent = "—";
      }
    
      const tdAvg = document.createElement("td");
      tdAvg.className = "right";
      tdAvg.textContent = euroNum(it.top10AvgUnit);
    
      // ✅ Cambio top10 avg
      const tdAvgDelta = document.createElement("td");
      tdAvgDelta.className = "right";
      if (prevIt) {
        const d = deltaInfo(it.top10AvgUnit, prevIt.top10AvgUnit);
        if (d) {
          const span = document.createElement("span");
          span.className = `delta ${d.cls}`;
          span.textContent = `${fmtEuroDiff(d.diff)} (${fmtPct(d.pct)})`;
          tdAvgDelta.appendChild(span);
        } else {
          tdAvgDelta.textContent = "—";
        }
      } else {
        tdAvgDelta.textContent = "—";
      }
    
      const tdSrc = document.createElement("td");
      if (it.url) {
        const a = document.createElement("a");
        a.href = it.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = it.provider || "link";
        tdSrc.appendChild(a);
      } else {
        tdSrc.textContent = it.provider || "—";
      }
    
      tr.appendChild(tdDate);
      tr.appendChild(tdCheapest);
      tr.appendChild(tdCheapestDelta);
      tr.appendChild(tdAvg);
      tr.appendChild(tdAvgDelta);
      tr.appendChild(tdSrc);
    
      tbody.appendChild(tr);
    }
  } catch (e) {
    meta.textContent = `Error cargando histórico: ${e.message}`;
  }
};