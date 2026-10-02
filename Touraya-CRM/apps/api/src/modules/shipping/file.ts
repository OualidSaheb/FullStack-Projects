import ExcelJS from 'exceljs';

type Cell = string | number;

function csvEscape(v: Cell): string {
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Renders a carrier file. XLSX follows the carrier template (wrapped multi-line headers). */
export async function renderFile(format: 'xlsx' | 'csv', headers: string[], rows: Cell[][]): Promise<Buffer> {
  if (format === 'csv') {
    const lines = [headers, ...rows].map((r) => r.map(csvEscape).join(','));
    return Buffer.from(`﻿${lines.join('\r\n')}`, 'utf8');
  }
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Feuil1');
  ws.addRow(headers);
  rows.forEach((r) => ws.addRow(r));
  const header = ws.getRow(1);
  header.font = { bold: true };
  header.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
  header.height = 60;
  ws.columns.forEach((col, i) => {
    const longest = Math.max(...[headers[i] ?? '', ...rows.map((r) => r[i] ?? '')].map((v) => Math.max(...String(v).split('\n').map((l) => l.length))));
    col.width = Math.min(Math.max(longest + 2, 10), 32);
  });
  // The phone column must stay text so leading zeros survive.
  ws.eachRow((row) => row.eachCell((cell) => { if (typeof cell.value === 'string' && /^0\d{8,9}/.test(cell.value)) cell.numFmt = '@'; }));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export const FILE_TYPES = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
} as const;
