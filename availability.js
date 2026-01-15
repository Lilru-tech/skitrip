'use strict';

// ✅ Misma webapp /exec (la misma de comments/groceries)
const AVAILABILITY_API_URL =
  'https://script.google.com/macros/s/AKfycbxiZhDqPpPTAV4En1UHysdFFljXNpdpi65WEGQQkHCuTjRLjHVdic60duPHmorRrTq4OQ/exec';

const AVAILABILITY_RESOURCE = 'availability';

// ------------------------------
// Estado
// ------------------------------
let currentUser = '';
let currentMonth = ''; // "YYYY-MM"

// Map: "YYYY-MM-DD" -> Array<{ id, date, user }>
let busyByDate = new Map();

// ------------------------------
// Helpers DOM / LocalStorage
// ------------------------------
function $(id) {
  return document.getElementById(id);
}

function getAvailabilityUser() {
  // ✅ HTML usa availabilityName
  const el = $('availabilityName');
  const v = (el?.value || localStorage.getItem('skitrip_availability_user') || '').trim();
  return v;
}

function saveAvailabilityUserToLocalStorage() {
  // ✅ HTML usa availabilityName
  const v = ($('availabilityName')?.value || '').trim();
  if (v) localStorage.setItem('skitrip_availability_user', v);
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toYYYYMM(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function normalizeMonthValue(raw) {
    const s = String(raw || '').trim().toLowerCase();
  
    // Caso ideal: "2026-03"
    if (/^\d{4}-\d{2}$/.test(s)) return s;
  
    // Caso input type="month" a veces puede traer "2026-03-01" (por seguridad)
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.slice(0, 7);
  
    // Caso label tipo "marzo de 2026"
    const m = s.match(/^([a-záéíóúñ]+)\s+de\s+(\d{4})$/i);
    if (m) {
      const monthName = m[1];
      const year = m[2];
      const map = {
        enero: '01',
        febrero: '02',
        marzo: '03',
        abril: '04',
        mayo: '05',
        junio: '06',
        julio: '07',
        agosto: '08',
        septiembre: '09',
        setiembre: '09',
        octubre: '10',
        noviembre: '11',
        diciembre: '12',
      };
      const mm = map[monthName];
      if (mm) return `${year}-${mm}`;
    }
  
    // Si no sabemos parsearlo, devolvemos vacío
    return '';
  }

function toYYYYMMDD(y, m, d) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function daysInMonth(y, m) {
  return new Date(y, m, 0).getDate(); // m=1..12
}

function weekdayIndexMondayFirst(dateObj) {
    const js = dateObj.getDay();
    return (js + 6) % 7;
  }
  
  // ------------------------------
  // Helpers UI calendario
  // ------------------------------
  function shortLabel_(name) {
    const n = String(name || '').trim();
    if (!n) return '?';
    // si es una palabra: inicial; si son varias: iniciales
    const parts = n.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
    return (parts[0].slice(0, 1) + parts[1].slice(0, 1)).toUpperCase();
  }
  
  function escapeHtml_(s) {
    return String(s || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

// ------------------------------
// JSONP helper (igual que comments)
// ------------------------------
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

// ------------------------------
// API (resource + action)
// ------------------------------
async function apiAvailabilityList(user, monthYYYYMM) {
  const params = new URLSearchParams();
  params.set('resource', AVAILABILITY_RESOURCE);
  params.set('action', 'list');
  params.set('user', String(user || ''));
  params.set('month', String(monthYYYYMM || '')); // "YYYY-MM"
  const url = `${AVAILABILITY_API_URL}?${params.toString()}`;

  const data = await jsonp(url);
  return Array.isArray(data?.items) ? data.items : [];
}

async function apiAvailabilityAdd(user, dateYYYYMMDD) {
  const params = new URLSearchParams();
  params.set('resource', AVAILABILITY_RESOURCE);
  params.set('action', 'add');
  params.set('user', String(user || ''));
  params.set('date', String(dateYYYYMMDD || '')); // "YYYY-MM-DD"
  const url = `${AVAILABILITY_API_URL}?${params.toString()}`;
  return await jsonp(url); // { ok:true, id:"..." }
}

async function apiAvailabilityDelete(id) {
  const params = new URLSearchParams();
  params.set('resource', AVAILABILITY_RESOURCE);
  params.set('action', 'delete');
  params.set('id', String(id || ''));
  const url = `${AVAILABILITY_API_URL}?${params.toString()}`;
  return await jsonp(url);
}

// ------------------------------
// Summary
// ------------------------------
function setAvailabilitySummary_(count) {
  const el = $('availabilitySummary');
  if (!el) return;

  const n = Number(count || 0);
  if (!n) {
    el.textContent = 'Sin días marcados';
    return;
  }

  el.textContent = `${n} día${n === 1 ? '' : 's'} ocupado${n === 1 ? '' : 's'}`;
}

function setAvailabilityHint_(text) {
  const el = $('availabilityHint');
  if (!el) return;
  el.textContent = text || '';
}

// ------------------------------
// Styles inline (solo 1 vez)
// ------------------------------
function ensureCalendarStylesOnce_() {
    // ✅ Ya no insertamos estilos inline: usamos styles.css (.calCell/.calTag)
    return;
  }

// ------------------------------
// Render calendario
// ------------------------------
function renderAvailabilityCalendar_(monthYYYYMM) {
    ensureCalendarStylesOnce_();
  
    const cal = $('availabilityCalendar');
    if (!cal) return;
  
    const [yStr, mStr] = (monthYYYYMM || '').split('-');
    const y = Number(yStr);
    const m = Number(mStr); // 1..12
  
    if (!y || !m) {
      cal.innerHTML = `<div class="muted">Selecciona un mes.</div>`;
      return;
    }
  
    const first = new Date(y, m - 1, 1);
    const offset = weekdayIndexMondayFirst(first);
    const dim = daysInMonth(y, m);
  
    const dows = ['L', 'M', 'X', 'J', 'V', 'S', 'D']
      .map((x) => `<div class="calDayHeader">${x}</div>`)
      .join('');
  
    let cells = '';
  
    // huecos inicio
    for (let i = 0; i < offset; i++) {
      cells += `<div class="calCell isEmpty"></div>`;
    }
  
    // días
    for (let d = 1; d <= dim; d++) {
      const key = toYYYYMMDD(y, m, d);
      const entries = busyByDate.get(key) || [];
      if (d === 7 || d === 8) {
        console.log('[availability] render key =>', key, 'entries =>', entries);
      }
      const meBusy = entries.some((e) => String(e.user || '') === String(currentUser || ''));
      const otherBusy = entries.some((e) => String(e.user || '') !== String(currentUser || ''));
  
      const cellClass = [
        'calCell',
        meBusy ? 'isMeBusy' : '',
        !meBusy && otherBusy ? 'isOtherBusyOnly' : '',
      ]
        .filter(Boolean)
        .join(' ');
  
      // tags: mostramos hasta 3 y luego +N
      const maxTags = 3;
      const shown = entries.slice(0, maxTags);
      const extra = entries.length - shown.length;
  
      const tagsHtml = shown
        .map((e) => {
          const u = String(e.user || '');
          const isMe = u === String(currentUser || '');
          const label = shortLabel_(u); // inicial(es)
          const full = escapeHtml_(u);
          return `<span class="calTag ${isMe ? 'meBusy' : 'otherBusy'}" title="${full}">${label}</span>`;
        })
        .join('');
  
      const extraHtml = extra > 0 ? `<span class="calTag otherBusy">+${extra}</span>` : '';
  
      cells += `
        <div class="${cellClass}" data-date="${key}">
          <div class="calNum">${d}</div>
          <div class="calTags">${tagsHtml}${extraHtml}</div>
        </div>
      `;
    }
  
    // contador: SOLO “mis” días ocupados en ese mes
    const myBusyCount = [...busyByDate.entries()]
      .filter(([date, entries]) => date.startsWith(monthYYYYMM))
      .filter(([, entries]) => entries.some((e) => String(e.user || '') === String(currentUser || '')))
      .length;
  
    cal.innerHTML = `
      <div class="availabilityCalendar">
        ${dows}
        ${cells}
      </div>
      <div class="muted" style="margin-top:10px;">
        Click en un día para alternar ocupado/libre. Marcados este mes (tú): <strong>${myBusyCount}</strong>
      </div>
    `;
  }

// ------------------------------
// Load mes
// ------------------------------
async function loadAvailabilityMonth_(user, monthYYYYMM) {
  setAvailabilityHint_(user ? `Editando disponibilidad de: ${user}` : 'Escribe tu nombre para editar.');

  const summary = $('availabilitySummary');
  if (summary) summary.textContent = 'Cargando…';

// ✅ Cargamos el mes completo para poder pintar “otros”
const list = await apiAvailabilityList('', monthYYYYMM);
console.log('[availability] load month =>', monthYYYYMM, 'user =>', user);
console.log('[availability] list (raw) =>', list);
console.log('[availability] list length =>', Array.isArray(list) ? list.length : 'NOT_ARRAY');
busyByDate = new Map();
for (const it of list) {
  const date = String(it?.date || '');
  const u = String(it?.user || it?.name || it?.username || ''); // según lo que devuelva tu backend
  const id = String(it?.id || '');
  if (!date) continue;

  const arr = busyByDate.get(date) || [];
  arr.push({ id, date, user: u });
  busyByDate.set(date, arr);
}
console.log('[availability] busyByDate size =>', busyByDate.size);
console.log('[availability] busyByDate keys sample =>', [...busyByDate.keys()].slice(0, 10));
const myCount = list.filter((it) => String(it?.user || it?.name || '') === String(user || '')).length;
setAvailabilitySummary_(myCount);
  renderAvailabilityCalendar_(monthYYYYMM);
}

// ------------------------------
// Toggle día (optimista)
// ------------------------------
async function toggleAvailabilityDay_(dateYYYYMMDD) {
    if (!currentUser || !currentMonth) return;
  
    const entries = busyByDate.get(dateYYYYMMDD) || [];
    const myIdx = entries.findIndex((e) => String(e.user || '') === String(currentUser || ''));
    const myExisting = myIdx >= 0 ? entries[myIdx] : null;
  
    // UI optimista
    if (myExisting) {
      entries.splice(myIdx, 1);
    } else {
      entries.push({ id: '__pending__', date: dateYYYYMMDD, user: currentUser });
    }
    busyByDate.set(dateYYYYMMDD, entries);
  
    renderAvailabilityCalendar_(currentMonth);
  
    try {
      if (myExisting?.id && myExisting.id !== '__pending__') {
        const delRes = await apiAvailabilityDelete(myExisting.id);
        console.log('[availability] delete response:', delRes);
      } else {
        const res = await apiAvailabilityAdd(currentUser, dateYYYYMMDD);
        const newId = res?.id ? String(res.id) : `local_${Date.now()}`;
        console.log('[availability] add response:', res);
        const arr2 = busyByDate.get(dateYYYYMMDD) || [];
        const i2 = arr2.findIndex((e) => String(e.user || '') === String(currentUser || ''));
        if (i2 >= 0) arr2[i2] = { id: newId, date: dateYYYYMMDD, user: currentUser };
        busyByDate.set(dateYYYYMMDD, arr2);
      }
    } catch (e) {
      console.warn('[availability] toggle failed, reloading month', e);
      await loadAvailabilityMonth_(currentUser, currentMonth);
      return;
    }
  
    // summary (solo tú)
    const myBusyCount = [...busyByDate.entries()]
      .filter(([date]) => date.startsWith(currentMonth))
      .filter(([, arr]) => (arr || []).some((e) => String(e.user || '') === String(currentUser || '')))
      .length;
  
    setAvailabilitySummary_(myBusyCount);
  }

// ------------------------------
// Abrir / cerrar modal
// ------------------------------
function openAvailabilityModal() {
  // ✅ HTML: availabilityName
  const userEl = $('availabilityName');
  if (userEl && !userEl.value) {
    userEl.value = localStorage.getItem('skitrip_availability_user') || '';
  }

  // ✅ HTML: availabilityMonth
  const monthEl = $('availabilityMonth');
  if (monthEl && !monthEl.value) monthEl.value = toYYYYMM(new Date());

  currentUser = getAvailabilityUser();
  currentMonth = normalizeMonthValue(monthEl?.value) || toYYYYMM(new Date());

  $('availabilityView')?.classList.remove('hidden');

  // Si no hay nombre, renderiza el mes igualmente (modo “solo ver”) y guía al usuario
  if (!currentUser) {
    setAvailabilityHint_('Escribe tu nombre y pulsa “Cargar” para ver/editar tus días.');
    setAvailabilitySummary_(0);
    renderAvailabilityCalendar_(currentMonth);
    return;
  }

  loadAvailabilityMonth_(currentUser, currentMonth);
}

function closeAvailabilityModal() {
  $('availabilityView')?.classList.add('hidden');
}

// ------------------------------
// Wiring UI
// ------------------------------
function wireAvailabilityUI() {
  // Botón principal (fuera del modal)
  $('openAvailabilityBtn')?.addEventListener('click', openAvailabilityModal);

  // Cerrar
  $('closeAvailabilityBtn')?.addEventListener('click', closeAvailabilityModal);
  $('closeAvailabilityBtnX')?.addEventListener('click', closeAvailabilityModal);

  // ✅ HTML tiene botón "Cargar"
  $('availabilityReloadBtn')?.addEventListener('click', async () => {
    saveAvailabilityUserToLocalStorage();
    currentUser = getAvailabilityUser();
    currentMonth = normalizeMonthValue($('availabilityMonth')?.value) || toYYYYMM(new Date());

    if (!currentUser) {
      setAvailabilityHint_('Escribe tu nombre y pulsa “Cargar”.');
      setAvailabilitySummary_(0);
      renderAvailabilityCalendar_(currentMonth);
      return;
    }

    await loadAvailabilityMonth_(currentUser, currentMonth);
  });

  // Cambia nombre (solo actualiza hint/LS; la carga real la haces con “Cargar”)
  $('availabilityName')?.addEventListener('input', () => {
    saveAvailabilityUserToLocalStorage();
  });

  // Cambia mes: si hay usuario cargado, recarga; si no, solo repinta calendario
  $('availabilityMonth')?.addEventListener('change', async (e) => {
    currentMonth = normalizeMonthValue(e.target?.value || '');
    if (!currentMonth) return;

    if (!currentUser) {
      renderAvailabilityCalendar_(currentMonth);
      setAvailabilitySummary_(0);
      return;
    }

    await loadAvailabilityMonth_(currentUser, currentMonth);
  });

  // Click en día (delegación sobre el contenedor)
  $('availabilityCalendar')?.addEventListener('click', async (e) => {
    const day = e.target.closest?.('.calCell[data-date]');
    if (!day) return;
  
    // no permitir click en “huecos”
    if (day.classList.contains('isEmpty')) return;
  
    const date = day.getAttribute('data-date');
    if (!date) return;
  
    if (!currentUser) {
      setAvailabilityHint_('Escribe tu nombre y pulsa “Cargar” para editar.');
      $('availabilityName')?.focus();
      return;
    }
  
    await toggleAvailabilityDay_(date);
  });

  // Click fuera para cerrar (igual que otros modales)
  $('availabilityView')?.addEventListener('click', (e) => {
    if (e.target?.id === 'availabilityView') closeAvailabilityModal();
  });
}

// Exponemos por si lo quieres llamar desde app.js
window.openAvailabilityModal = openAvailabilityModal;

// ✅ Robustez: si el script carga cuando DOMContentLoaded ya pasó, igualmente se cablea
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wireAvailabilityUI);
} else {
  wireAvailabilityUI();
}