'use strict';

// ✅ Tu webapp /exec (la misma de comments)
const API_URL =
  'https://script.google.com/macros/s/AKfycbxiZhDqPpPTAV4En1UHysdFFljXNpdpi65WEGQQkHCuTjRLjHVdic60duPHmorRrTq4OQ/exec';
const RESOURCE = 'groceries';

// ------------------------------
// Fallback local (por si falla la API)
// ------------------------------
let groceries = [
  { id: 'patatas', name: 'Patatas fritas (Hacendado)', price: 1.35, quantity: 3, perDay: false },
  { id: 'fuet', name: 'Fuet / Embutido (Hacendado)', price: 2.57, quantity: 2, perDay: false },
  { id: 'queso', name: 'Queso (rallado o porcion)', price: 1.64, quantity: 2, perDay: false },
  { id: 'aceitunas', name: 'Aceitunas (Hacendado)', price: 2.15, quantity: 1, perDay: false },
  { id: 'chuches', name: 'Golosinas / chuches', price: 1.5, quantity: 1, perDay: false },
  { id: 'galletas', name: 'Galletas (Hacendado)', price: 1.2, quantity: 1, perDay: false },
  { id: 'chocolate', name: 'Chocolate / turrón', price: 2.7, quantity: 1, perDay: false },

  {
    id: 'tortilla',
    name: 'Tortilla de patata (Hacendado)',
    price: 2.79,
    quantity: 1,
    perDay: false,
  },
  { id: 'empanada', name: 'Empanada (Hacendado)', price: 1.75, quantity: 1, perDay: false },
  { id: 'hummus', name: 'Hummus (Hacendado)', price: 1.5, quantity: 1, perDay: false },
  { id: 'guacamole', name: 'Guacamole (Hacendado)', price: 1.85, quantity: 1, perDay: false },
  { id: 'nachos', name: 'Nachos (Hacendado)', price: 0.9, quantity: 1, perDay: false },
  { id: 'zanahorias', name: 'Zanahorias (1 kg aprox.)', price: 1.7, quantity: 1, perDay: false },

  { id: 'tomate', name: 'Tomate triturado (Hacendado)', price: 0.64, quantity: 2, perDay: false },
  { id: 'aceite', name: 'Aceite de oliva (Hacendado)', price: 4.2, quantity: 1, perDay: false },
  { id: 'jamon', name: 'Jamón serrano (Hacendado)', price: 6.5, quantity: 1, perDay: false },

  { id: 'leche', name: 'Leche semidesnatada (Hacendado)', price: 0.88, quantity: 3, perDay: true },
  { id: 'cafe', name: 'Café molido (Hacendado)', price: 3.5, quantity: 1, perDay: false },
  { id: 'colaCao', name: 'Cacao a la taza (Hacendado)', price: 2.2, quantity: 1, perDay: false },
  { id: 'bizcocho', name: 'Bizcocho / bollería', price: 2.6, quantity: 1, perDay: false },
  { id: 'pan', name: 'Pan (barra o pan de horno)', price: 1.19, quantity: 2, perDay: true },
  { id: 'mantequilla', name: 'Mantequilla (Hacendado)', price: 2.5, quantity: 1, perDay: false },
  { id: 'mermelada', name: 'Mermelada (Hacendado)', price: 1.8, quantity: 1, perDay: false },

  {
    id: 'barritas',
    name: 'Barritas energéticas / chocolate',
    price: 2.0,
    quantity: 2,
    perDay: false,
  },
  { id: 'fruta', name: 'Fruta (plátanos/mandarinas)', price: 1.8, quantity: 2, perDay: true },

  { id: 'coca_cola', name: 'Coca-Cola (lata 330 ml)', price: 0.8, quantity: 6, perDay: false },
  { id: 'vermut', name: 'Vermut (botella)', price: 4.5, quantity: 1, perDay: false },
  { id: 'cerveza', name: 'Cerveza (Hacendado)', price: 0.8, quantity: 24, perDay: false },
  { id: 'agua', name: 'Agua (pack)', price: 1.5, quantity: 3, perDay: false },
  { id: 'vino', name: 'Vino tinto / blanco', price: 3.5, quantity: 2, perDay: false },

  { id: 'sal', name: 'Sal de mesa (Hacendado)', price: 0.99, quantity: 1, perDay: false },
  { id: 'papel_cocina', name: 'Papel de cocina', price: 2.5, quantity: 1, perDay: false },
  { id: 'lavavajillas', name: 'Lavavajillas líquido', price: 1.2, quantity: 1, perDay: false },
  { id: 'estropajo', name: 'Estropajo', price: 0.99, quantity: 1, perDay: false },
  { id: 'bolsas_basura', name: 'Bolsas de basura', price: 1.5, quantity: 1, perDay: false },
  { id: 'bolsas_congelar', name: 'Bolsas de congelar', price: 1.8, quantity: 1, perDay: false },
];

let apiReady = false;

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

async function apiGroceriesList() {
  const url = `${API_URL}?resource=${encodeURIComponent(RESOURCE)}&action=list`;
  const data = await jsonp(url);
  return Array.isArray(data?.groceries) ? data.groceries : [];
}

async function apiGroceriesAdd(payload) {
  const params = new URLSearchParams();
  params.set('resource', RESOURCE);
  params.set('action', 'add');
  params.set('name', String(payload.name ?? ''));
  params.set('price', String(payload.price ?? 0));
  params.set('quantity', String(payload.quantity ?? 1));
  params.set('perDay', String(!!payload.perDay));
  const url = `${API_URL}?${params.toString()}`;
  return await jsonp(url);
}

async function apiGroceriesEdit(id, patch) {
  const params = new URLSearchParams();
  params.set('resource', RESOURCE);
  params.set('action', 'edit');
  params.set('id', String(id));

  // solo enviamos lo que cambie
  if (patch.name != null) params.set('name', String(patch.name));
  if (patch.price != null) params.set('price', String(patch.price));
  if (patch.quantity != null) params.set('quantity', String(patch.quantity));
  if (patch.perDay != null) params.set('perDay', String(!!patch.perDay));

  const url = `${API_URL}?${params.toString()}`;
  return await jsonp(url);
}

async function apiGroceriesDelete(id) {
  const params = new URLSearchParams();
  params.set('resource', RESOURCE);
  params.set('action', 'delete');
  params.set('id', String(id));
  const url = `${API_URL}?${params.toString()}`;
  return await jsonp(url);
}

// ------------------------------
// Carga inicial desde Sheet
// ------------------------------
async function loadGroceriesFromApi() {
  try {
    const list = await apiGroceriesList();
    if (list.length) {
      groceries = list.map((g) => ({
        id: String(g.id),
        name: String(g.name || ''),
        price: Number(g.price || 0),
        quantity: Number(g.quantity || 0),
        perDay: !!g.perDay,
      }));
    }
    apiReady = true;
    return true;
  } catch (e) {
    console.warn('[groceries] API not available, using fallback local list.', e);
    apiReady = false;
    return false;
  }
}

// ------------------------------
// Cálculos
// ------------------------------
function computeGroceriesTotal(tripDays) {
  let total = 0;
  for (const g of groceries) {
    const qty = g.perDay ? Number(g.quantity || 0) * tripDays : Number(g.quantity || 0);
    total += qty * Number(g.price || 0);
  }
  return total;
}

function computeGroceriesPerPerson(tripDays, numPeople) {
  if (numPeople <= 0) return 0;
  return computeGroceriesTotal(tripDays) / numPeople;
}

// ------------------------------
// UI Render
// ------------------------------
function renderGroceriesTable(tripDays) {
  const table = document.getElementById('groceriesTable');
  if (!table) return;

  const tbody = table.querySelector('tbody');
  if (!tbody) return;

  tbody.innerHTML = '';

  for (const g of groceries) {
    const tr = document.createElement('tr');

    // Producto
    const tdName = document.createElement('td');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = g.name ?? '';
    nameInput.addEventListener('input', () =>
      scheduleEdit(g.id, { name: nameInput.value }, tripDays)
    );
    tdName.appendChild(nameInput);

    // €
    const tdPrice = document.createElement('td');
    const priceInput = document.createElement('input');
    priceInput.type = 'number';
    priceInput.step = '0.01';
    priceInput.min = '0';
    priceInput.value = String(g.price ?? 0);
    priceInput.addEventListener('input', () =>
      scheduleEdit(g.id, { price: Number(priceInput.value || 0) }, tripDays)
    );
    tdPrice.appendChild(priceInput);

    // Cantidad
    const tdQty = document.createElement('td');
    const qtyInput = document.createElement('input');
    qtyInput.type = 'number';
    qtyInput.step = '1';
    qtyInput.min = '0';
    qtyInput.value = String(g.quantity ?? 0);
    qtyInput.addEventListener('input', () =>
      scheduleEdit(g.id, { quantity: Number(qtyInput.value || 0) }, tripDays)
    );
    tdQty.appendChild(qtyInput);

    // Por día
    const tdPerDay = document.createElement('td');
    const perDayInput = document.createElement('input');
    perDayInput.type = 'checkbox';
    perDayInput.checked = !!g.perDay;
    perDayInput.addEventListener('change', () =>
      scheduleEdit(g.id, { perDay: perDayInput.checked }, tripDays)
    );
    tdPerDay.appendChild(perDayInput);

    // Delete
    const tdDel = document.createElement('td');
    const delBtn = document.createElement('button');
    delBtn.className = 'secondary';
    delBtn.textContent = '🗑️';
    delBtn.addEventListener('click', async () => {
      // UI optimista
      groceries = groceries.filter((x) => x.id !== g.id);
      renderGroceriesTable(tripDays);
      document.getElementById('recalcBtn')?.click();

      if (apiReady) {
        try {
          await apiGroceriesDelete(g.id);
        } catch (e) {
          console.warn('[groceries] delete failed', e);
        }
      }
    });
    tdDel.appendChild(delBtn);

    tr.appendChild(tdName);
    tr.appendChild(tdPrice);
    tr.appendChild(tdQty);
    tr.appendChild(tdPerDay);
    tr.appendChild(tdDel);

    tbody.appendChild(tr);
  }
}

function scrollGroceriesModalToBottom() {
  const modalCard = document.querySelector('#groceriesView .modalCard');
  if (!modalCard) return;
  modalCard.scrollTop = modalCard.scrollHeight;
}

// ------------------------------
// Persistencia con debounce (evita spamear)
// ------------------------------
const pendingTimers = new Map();

function scheduleEdit(id, patch, tripDays) {
  // actualiza local inmediato
  const g = groceries.find((x) => x.id === id);
  if (g) Object.assign(g, patch);

  // refresca el resumen y la tabla principal
  document.getElementById('recalcBtn')?.click();

  // si no hay API, solo local
  if (!apiReady) return;

  // debounce por id
  const prev = pendingTimers.get(id);
  if (prev) clearTimeout(prev);

  const t = setTimeout(async () => {
    try {
      await apiGroceriesEdit(id, patch);
    } catch (e) {
      console.warn('[groceries] edit failed', e);
    } finally {
      pendingTimers.delete(id);
    }
  }, 350);

  pendingTimers.set(id, t);
}

// ------------------------------
// API expuesta a app.js
// ------------------------------
window.computeGroceriesTotal = computeGroceriesTotal;
window.computeGroceriesPerPerson = computeGroceriesPerPerson;

// app.js llama esto al abrir modal
window.renderGroceriesView = async function (tripDays, numPeople) {
  // al abrir modal, refrescamos desde sheet (una vez)
  await loadGroceriesFromApi();

  renderGroceriesTable(tripDays);

  // resumen
  const summary = document.getElementById('groceriesSummary');
  if (summary) {
    const total = computeGroceriesTotal(tripDays);
    const perPerson = computeGroceriesPerPerson(tripDays, numPeople);
    summary.textContent = `Total compra: ${total.toFixed(2)} € · ${perPerson.toFixed(2)} €/persona`;
  }
};

// Botón "Añadir producto"
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('addGroceryBtn')?.addEventListener('click', async () => {
    const tripDays = Number(document.getElementById('skiDays')?.value || 2);

    const newItem = {
      name: 'Nuevo producto',
      price: 1,
      quantity: 1,
      perDay: false,
    };

    if (apiReady) {
      try {
        const res = await apiGroceriesAdd(newItem);
        if (res?.ok && res?.id) {
          groceries.push({ id: String(res.id), ...newItem }); // ✅ antes unshift
        } else {
          // fallback local si algo raro
          groceries.push({ id: `local_${Date.now()}`, ...newItem }); // ✅ antes unshift
        }
      } catch (e) {
        console.warn('[groceries] add failed', e);
        groceries.push({ id: `local_${Date.now()}`, ...newItem }); // ✅ antes unshift
      }
    } else {
      groceries.push({ id: `local_${Date.now()}`, ...newItem }); // ✅ antes unshift
    }

    renderGroceriesTable(tripDays);
    scrollGroceriesModalToBottom(); // ✅ NUEVO
    document.getElementById('recalcBtn')?.click();
  });
});
