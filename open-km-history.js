'use strict';

const OPEN_KM_HISTORY_URL = './data/open_km_history.json';

function $(id) {
  return document.getElementById(id);
}

function fmtDelta(n) {
  if (n == null || Number.isNaN(n)) return { text: '—', cls: 'flat' };
  if (n > 0) return { text: `+${n}`, cls: 'up' };
  if (n < 0) return { text: `${n}`, cls: 'down' };
  return { text: '0', cls: 'flat' };
}

async function loadOpenKmHistory() {
  const res = await fetch(`${OPEN_KM_HISTORY_URL}?v=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('No se pudo cargar open_km_history.json');
  return await res.json();
}

// expone en window:
window.openKmHistory = null;
window.openKmDeltaByResortId = {};

window.initOpenKmHistory = async function initOpenKmHistory() {
  try {
    const hist = await loadOpenKmHistory();
    window.openKmHistory = hist;

    const by = hist?.byResortId || {};
    const deltaMap = {};

    for (const [resortId, arr] of Object.entries(by)) {
      if (!Array.isArray(arr) || arr.length < 2) {
        deltaMap[resortId] = null;
        continue;
      }

      const last = arr[arr.length - 1];
      const prev = arr[arr.length - 2];

      const lastVal = typeof last?.openKm === 'number' ? last.openKm : null;
      const prevVal = typeof prev?.openKm === 'number' ? prev.openKm : null;

      if (lastVal == null || prevVal == null) {
        deltaMap[resortId] = null;
        continue;
      }

      const delta = lastVal - prevVal;

      // % vs ayer (si ayer=0 no mostramos %)
      const pct = prevVal === 0 ? null : (delta / prevVal) * 100;

      deltaMap[resortId] = {
        delta,
        pct: Number.isFinite(pct) ? pct : null,
      };
    }

    window.openKmDeltaByResortId = deltaMap;
  } catch (e) {
    console.warn('[open-km-history] No se pudo cargar histórico', e);
    window.openKmHistory = { byResortId: {} };
    window.openKmDeltaByResortId = {};
  }
};

window.openOpenKmHistoryForResort = function openOpenKmHistoryForResort(resortId, resortName) {
  const view = $('openKmHistoryView');
  const tbody = $('openKmHistoryTbody');
  const title = $('openKmHistoryTitle');
  const meta = $('openKmHistoryMeta');
  if (!view || !tbody) return;

  title.textContent = `📊 Histórico km abiertos · ${resortName}`;
  const arr = window.openKmHistory?.byResortId?.[resortId] || [];

  meta.textContent = arr.length
    ? `Entradas: ${arr.length}`
    : 'Sin histórico todavía (se generará tras el primer update diario).';

  tbody.innerHTML = '';

  for (let i = arr.length - 1; i >= 0; i--) {
    const cur = arr[i];
    const prev = arr[i - 1];
    const delta =
      prev && Number.isFinite(cur.openKm) && Number.isFinite(prev.openKm)
        ? cur.openKm - prev.openKm
        : null;

    const d = fmtDelta(delta);

    const tr = document.createElement('tr');

    const tdDate = document.createElement('td');
    tdDate.textContent = cur.date || '—';

    const tdOpen = document.createElement('td');
    tdOpen.className = 'right';
    tdOpen.textContent = cur.openKm ?? '—';

    const tdDelta = document.createElement('td');
    tdDelta.className = `right delta ${d.cls}`;
    tdDelta.textContent = d.text;

    tr.appendChild(tdDate);
    tr.appendChild(tdOpen);
    tr.appendChild(tdDelta);
    tbody.appendChild(tr);
  }

  view.classList.remove('hidden');
};
