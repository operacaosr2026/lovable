import * as XLSX from "xlsx";

// Importação de payouts por planilha (xlsx/xls/csv) — mesma regra do Fluxo de
// Caixa do Scalemoon: acha as colunas "Payout Date" e "Net" (sem diferenciar
// maiúsculas/espaços) e soma o "Net" por data de payout.

const DAY_MS = 86_400_000;
const DRIFT_TOLERANCE_MS = 1000;

function dayStartMs(ms: number) {
  return Math.floor((ms + DRIFT_TOLERANCE_MS) / DAY_MS) * DAY_MS;
}
function msToDateKey(ms: number) {
  return new Date(dayStartMs(ms)).toISOString().slice(0, 10);
}

function parseDateCell(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : msToDateKey(raw.getTime());
  // Serial do Excel (dias desde 1899-12-30).
  if (typeof raw === "number") return msToDateKey((raw - 25569) * DAY_MS);
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const parsed = new Date(s);
  return isNaN(parsed.getTime()) ? null : msToDateKey(parsed.getTime());
}

function parseNetCell(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") return raw;
  let s = String(raw).trim().replace(/[^\d.,-]/g, "");
  if (!s) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma > -1) {
    s = s.length - lastComma - 1 === 2 ? s.replace(",", ".") : s.replace(/,/g, "");
  }
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

export type PayoutRow = { date: string; amount: number };

export async function parsePayoutFile(file: File, minDate?: string | null): Promise<PayoutRow[]> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error(`${file.name}: a planilha não tem nenhuma aba.`);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, raw: true, defval: null });
  if (rows.length === 0) throw new Error(`${file.name}: planilha vazia.`);

  const header = (rows[0] ?? []).map((h) => String(h ?? "").trim().toLowerCase());
  const dateIdx = header.indexOf("payout date");
  const netIdx = header.indexOf("net");
  if (dateIdx === -1 || netIdx === -1) {
    throw new Error(`${file.name}: não achei as colunas "Payout Date" e "Net".`);
  }

  const sums = new Map<string, number>();
  for (const row of rows.slice(1)) {
    if (!row) continue;
    const date = parseDateCell(row[dateIdx]);
    const net = parseNetCell(row[netIdx]);
    if (date == null || net == null) continue;
    if (minDate && date < minDate) continue;
    sums.set(date, (sums.get(date) ?? 0) + net);
  }
  if (sums.size === 0) throw new Error(`${file.name}: nenhum payout válido encontrado.`);
  return [...sums.entries()]
    .map(([date, amount]) => ({ date, amount: Math.round(amount * 100) / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
