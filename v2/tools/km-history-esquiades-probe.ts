// Investigación (solo lectura): ¿las capturas archivadas por la Wayback Machine de la página de estado de pistas de
// Esquiades se pueden leer con el mismo analizador que usa SkiTrip? Imprime, por captura de temporada, la fecha del
// parte y los km de unas estaciones de ejemplo. No escribe en la API ni en D1.
import { parseEsquiadesStatusHtml } from '../src/core/parsers/snow';
const UA = 'SkiTrip-research/1.0 (+https://github.com/Lilru-tech/skitrip)';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const URL0 = 'www.esquiades.com/informacion-interes/estado-pistas/';
const cdx = await (await fetch(`https://web.archive.org/cdx/search/cdx?output=json&url=${URL0}&filter=statuscode:200&fl=timestamp&from=2014`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(60000) })).json() as string[][];
const stamps = cdx.slice(1).map((r) => r[0]).filter((t) => { const m = Number(t.slice(4, 6)); return m >= 11 || m <= 5; });
const seenDay = new Set<string>();
for (const ts of stamps) {
  if (seenDay.has(ts.slice(0, 8))) continue;
  seenDay.add(ts.slice(0, 8));
  try {
    const r = await fetch(`https://web.archive.org/web/${ts}id_/https://${URL0}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(60000) });
    const html = await r.text();
    const rows = parseEsquiadesStatusHtml(html);
    const pick = rows.filter((x) => /baqueira|grandvalira|formigal|la molina|cerler|port del comte|boi|masella/i.test(x.nameNorm ?? ''));
    console.log(`## ${ts}: HTTP ${r.status}, ${html.length} B, ${rows.length} filas; ${pick.slice(0, 8).map((x) => `${x.nameNorm}=${x.openKm ?? '–'}/${x.totalKm ?? '–'}@${x.sourceDate ?? '?'}`).join(' | ')}`);
  } catch (e) { console.log(`## ${ts}: error ${e}`); }
  await sleep(3000);
}
