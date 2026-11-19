// SkiTrip v2 · investigación de fuentes de histórico de km esquiables (solo lectura, sin secretos). Consulta el índice
// público CDX de la Wayback Machine (Internet Archive) para saber qué páginas de partes de nieve se archivaron y cuántos
// días de temporada cubren. Imprime el resultado en el registro. No escribe en la API ni en D1.
const UA = 'SkiTrip-research/1.0 (+https://github.com/Lilru-tech/skitrip)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mode = process.argv[2] ?? 'discover';
const URLS_DEFAULT = `
www.esquiades.com/informacion-interes/estado-pistas/
www.grandvalira.com/es/estacion/parte-nieve
www.grandvalira.com/ca/estacio/estat-de-pistes
www.grandvalira.com/es/parte-de-nieve
www.palarinsal.com/es/estacion/parte-nieve
www.ordinoarcalis.com/es/estacion/parte-nieve
www.baqueira.es/estado-pistas
www.baqueira.es/parte-de-nieve
www.portdelcomte.net/pistes/
www.cerler.com/partes/parteNieve
www.formigal-panticosa.com/partes/parteNieve
www.lamolina.cat/infoneu
www.masella.com/parte-de-nieve/
www.infonieve.es/estado-pistas/
www.nevasport.com/partes/
www.skiinfo.es/pirineo-catalan/parte-de-nieve.html
www.skiinfo.es/andorra/parte-de-nieve.html
www.skiinfo.es/pirineo-aragones/parte-de-nieve.html
www.ax.ski/en/ouverture-pistes
www.altiservice.com/font-romeu-pyrenees-2000/info-pistes
`;

async function cdx(params) {
  const sp = new URLSearchParams({ output: 'json' });
  for (const [k, v] of Object.entries(params)) for (const x of [v].flat()) sp.append(k, x);
  const u = 'https://web.archive.org/cdx/search/cdx?' + sp;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(u, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(45000) });
      if (r.status === 429 || r.status >= 500) { await sleep(5000 * (i + 1)); continue; }
      if (!r.ok) return { error: r.status };
      const t = await r.text();
      const rows = t.trim() ? JSON.parse(t) : [];
      return { rows: rows.slice(1), head: rows[0] };
    } catch (e) { await sleep(3000 * (i + 1)); if (i === 3) return { error: String(e) }; }
  }
  return { error: 'retries' };
}

const DOMAINS = [
  'esquiades.com', 'nevasport.com', 'infonieve.es', 'skiinfo.es', 'atudem.es', 'snowy.es', 'pirineu365.cat', 'pirineu365.com',
  'grandvalira.com', 'palarinsal.com', 'ordinoarcalis.com', 'baqueira.es', 'lamolina.cat', 'masella.com', 'portdelcomte.net',
  'cerler.com', 'formigal-panticosa.com', 'aramon.com', 'astuncandanchu.com', 'astun.com', 'candanchu.com', 'valdelinares.com',
  'javalambre.com', 'altiservice.com', 'ax.ski', 'ax-ski.com', 'lesangles.com', 'skipass.com', 'onthesnow.es', 'meteored.com',
  'tiempo.com', 'skiandorra.ad', 'esquiar.com', 'valldenuria.cat', 'espotesqui.cat', 'boitaullresort.com', 'portaine.cat',
];
const KEYWORDS = /(parte|estado|estat|pistes|pistas|neige|snow|nieve|neu|ouverture|enneigement|report|info-pistes)/i;

function seasonOf(ts) { // ts = yyyymmddhhmmss → temporada «2019-20» si cae entre noviembre y mayo
  const y = Number(ts.slice(0, 4)), m = Number(ts.slice(4, 6));
  if (m >= 11) return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
  if (m <= 5) return `${y - 1}-${String(y % 100).padStart(2, '0')}`;
  return null;
}

if (mode === 'discover') {
  for (const d of DOMAINS) {
    const t0 = Date.now();
    const res = await cdx({ url: d, matchType: 'domain', collapse: 'urlkey', fl: 'original', limit: '400',
      filter: ['statuscode:200', 'original:.*(parte|estado|estat|pistes|pistas|neige|snow|nieve|ouverture|enneigement|report).*'] });
    if (res.error) { console.log(`## ${d}: error ${res.error}`); await sleep(2000); continue; }
    const urls = res.rows.map((r) => r[0]).filter((u) => KEYWORDS.test(u) && !/\.(jpg|png|gif|css|js|svg|webp|pdf|ico)(\?|$)/i.test(u));
    console.log(`## ${d}: ${res.rows.length} urls candidatas (${urls.length} tras filtro) en ${Date.now() - t0} ms`);
    for (const u of urls.slice(0, 40)) console.log('   ', u);
    await sleep(2000);
  }
} else {
  // mode=count: URLs a contar en la variable de entorno URLS (una por línea)
  for (const u of (process.env.URLS || URLS_DEFAULT).split('\n').map((s) => s.trim()).filter(Boolean)) {
    const res = await cdx({ url: u, fl: 'timestamp,statuscode', filter: 'statuscode:200', from: '2010', limit: '20000' });
    if (res.error) { console.log(`## ${u}: error ${res.error}`); await sleep(2000); continue; }
    const days = new Map();
    for (const [ts] of res.rows) { const s = seasonOf(ts); if (!s) continue; const set = days.get(s) ?? new Set(); set.add(ts.slice(0, 8)); days.set(s, set); }
    const line = [...days.entries()].sort().map(([s, set]) => `${s}:${set.size}`).join(' ');
    console.log(`## ${u}: ${res.rows.length} capturas · días de temporada por temporada → ${line || 'ninguno'}`);
    await sleep(2000);
  }
}
