// Genera los PDF de prueba de tickets (sintéticos, sin datos reales) en test/fixtures/receipts.
// - ticket-texto.pdf: ticket con capa de texto, con cada columna como fragmento separado (como los PDF de supermercado).
// - ticket-imagen.pdf: PDF sin texto (solo dibujo), equivalente a un ticket escaneado o fotografiado.
// Uso: node tools/make-receipt-pdf.mjs
import { writeFileSync } from 'node:fs';

function pdf(content) {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 226 420] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);
// [y, [x, texto]...]: columnas separadas en la misma línea base.
const rows = [
  [400, [10, 'SUPERMERCADO EJEMPLO, S.A.']],
  [388, [10, 'C/ EJEMPLO 1']],
  [376, [10, '43007 TARRAGONA']],
  [364, [10, '30/09/2026 18:42'], [110, 'OP: 1']],
  [352, [10, 'FACTURA SIMPLIFICADA: 0001-001-000001']],
  [336, [10, 'Descripción'], [130, 'P. Unit'], [180, 'Importe']],
  [324, [10, '1'], [22, 'LECHE ENTERA'], [180, '0,89']],
  [312, [10, '2'], [22, 'AGUA MINERAL 5L'], [130, '1,20'], [180, '2,40']],
  [300, [10, '1'], [22, 'PAN DE MOLDE'], [180, '1,45']],
  [288, [10, '3'], [22, 'YOGUR NATURAL'], [130, '0,35'], [180, '1,05']],
  [272, [10, 'TOTAL (€)'], [180, '5,79']],
  [260, [10, 'TARJETA BANCARIA'], [180, '5,79']],
];
const text = ['BT /F1 8 Tf'];
for (const [y, ...cols] of rows) for (const [x, s] of cols) text.push(`1 0 0 1 ${x} ${y} Tm (${esc(s)}) Tj`);
text.push('ET');
// WinAnsi: «€» es 0x80 y «ó» 0xF3 en latin1 extendido.
const body = text.join('\n').replace(/€/g, '\x80');
writeFileSync('test/fixtures/receipts/ticket-texto.pdf', pdf(body));
writeFileSync('test/fixtures/receipts/ticket-imagen.pdf', pdf('0.2 g 10 10 206 400 re f\n1 g 20 380 120 8 re f'));
console.log('ok');
