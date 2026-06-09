import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/* ==================== CSV parser ==================== */

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQ = false;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { cur.push(field); field = ""; }
      else if (c === "\n") { cur.push(field); rows.push(cur); cur = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else field += c;
    }
  }
  if (field.length > 0 || cur.length > 0) { cur.push(field); rows.push(cur); }
  return rows.filter((r) => r.some((v) => v.trim().length > 0));
}

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normHeader(h: string): string {
  return stripDiacritics(h).toLowerCase().trim().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

function parseDate(s: string): string | null {
  if (!s) return null;
  s = s.trim();
  const mk = (y: string | number, mo: number, d: number): string | null => {
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  };
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const y = m[1]; let a = parseInt(m[2], 10), b = parseInt(m[3], 10);
    // a=month, b=day; if month>12 but day<=12, swap (handles YYYY-DD-MM)
    if (a > 12 && b <= 12) [a, b] = [b, a];
    const r = mk(y, a, b); if (r) return r;
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const a = parseInt(m[1], 10), b = parseInt(m[2], 10), y = m[3];
    const [mo, d] = a > 12 ? [b, a] : [a, b];
    const r = mk(y, mo, d); if (r) return r;
  }
  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (m) {
    const a = parseInt(m[1], 10), b = parseInt(m[2], 10), y = m[3];
    const [mo, d] = a > 12 ? [b, a] : [a, b];
    const r = mk(y, mo, d); if (r) return r;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function parseAmount(s: string): number | null {
  if (!s) return null;
  s = s.trim().replace(/[$€£R\s]/g, "");
  let neg = false;
  if (s.startsWith("(") && s.endsWith(")")) { neg = true; s = s.slice(1, -1); }
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  return neg ? -n : n;
}

type ParsedRow = {
  external_id: string | null;
  date: string;
  description: string;
  amount: number;
  source_account_text: string;
};

type ColumnMapping = {
  date: number;
  description: number;
  amount: number;
  external_id?: number | null;
  source_account?: number | null;
  status?: number | null;
};

function autoDetect(header: string[]): { provider: "mercury" | "wise" | "generic"; mapping: ColumnMapping } {
  const h = header.map(normHeader);
  const idx = (names: string[]): number => {
    for (const n of names) { const i = h.indexOf(n); if (i >= 0) return i; }
    return -1;
  };
  const isWise = h.includes("transferwise_id") || h.includes("running_balance");
  const isMercury = h.includes("ending_balance") || (h.includes("status") && h.includes("source_account"));
  const provider: "mercury" | "wise" | "generic" = isWise ? "wise" : isMercury ? "mercury" : "generic";

  const iDate = idx(["date", "transaction_date", "posted_date", "created_at", "data", "data_da_transacao"]);
  const iDesc = idx(["description", "merchant", "payee_name", "payer_name", "descricao", "details", "name", "memo", "note", "reference", "payment_reference"]);
  const iAmt = idx(["amount", "valor", "value", "quantia"]);
  const iId = idx(["transferwise_id", "reference", "transaction_id", "transfer_id", "mercury_transaction_id", "id"]);
  const iSrc = idx(["source_account", "account", "account_name", "bank_account", "from", "from_account", "conta", "conta_origem"]);
  const iStatus = idx(["status", "state", "situacao", "estado", "resultado", "transaction_status", "payment_status"]);

  return {
    provider,
    mapping: {
      date: iDate,
      description: iDesc,
      amount: iAmt,
      external_id: iId >= 0 ? iId : null,
      source_account: iSrc >= 0 ? iSrc : null,
      status: iStatus >= 0 ? iStatus : null,
    },
  };
}

// Statuses meaning the transaction did NOT settle — skip on import.
const SKIP_STATUS_TERMS = [
  "failed", "failure", "fail", "error", "cancelled", "canceled", "declined", "decline", "rejected",
  "reversed", "returned", "refused", "void", "voided", "expired", "insufficient funds",
  "falhada", "falhado", "falhadas", "falhados", "falhou", "falha", "erro", "cancelada", "cancelado",
  "canceladas", "cancelados", "recusada", "recusado", "recusadas", "recusados", "estornada", "estornado",
  "estornadas", "estornados", "devolvida", "devolvido", "devolvidas", "devolvidos", "rejeitada", "rejeitado",
  "rejeitadas", "rejeitados", "expirada", "expirado",
];

function shouldSkipStatus(raw: string): boolean {
  const normalized = stripDiacritics(raw).toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  return SKIP_STATUS_TERMS.some((term) => normalized === term || normalized.includes(term));
}

function parseWithMapping(rows: string[][], mapping: ColumnMapping): ParsedRow[] {
  const parsed: ParsedRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (mapping.status != null && mapping.status >= 0) {
      const st = (row[mapping.status] ?? "").trim();
      if (shouldSkipStatus(st)) continue;
    } else if (row.some((cell) => {
      const value = (cell ?? "").trim();
      return value.length > 0 && value.length <= 48 && shouldSkipStatus(value);
    })) {
      continue;
    }
    const date = mapping.date >= 0 ? parseDate(row[mapping.date] ?? "") : null;
    const amount = mapping.amount >= 0 ? parseAmount(row[mapping.amount] ?? "") : null;
    if (!date || amount === null || amount === 0) continue;
    const description = mapping.description >= 0 ? (row[mapping.description] ?? "").trim() : "";
    const ext = mapping.external_id != null && mapping.external_id >= 0 ? (row[mapping.external_id] ?? "").trim() : "";
    const src = mapping.source_account != null && mapping.source_account >= 0 ? (row[mapping.source_account] ?? "").trim() : "";
    parsed.push({ external_id: ext || null, date, description, amount, source_account_text: src });
  }
  return parsed;
}

/* ==================== account routing ==================== */

type AccountLite = { id: string; name: string; currency: string; match_keywords: string[] };

const PENDING_ACCOUNT_NAME = "⏳ Pendentes";

async function getOrCreatePendingAccount(supabase: any, userId: string): Promise<AccountLite> {
  const { data: existing } = await supabase
    .from("accounts").select("id, name, currency, match_keywords")
    .eq("user_id", userId).eq("name", PENDING_ACCOUNT_NAME).maybeSingle();
  if (existing) return { ...existing, match_keywords: existing.match_keywords ?? [] };
  const { data: created, error } = await supabase
    .from("accounts").insert({
      user_id: userId,
      name: PENDING_ACCOUNT_NAME,
      currency: "BRL",
      color: "oklch(0.7 0.14 75)",
      position: 999,
    }).select("id, name, currency, match_keywords").single();
  if (error) throw new Error("Falha ao criar conta Pendentes: " + error.message);
  return { ...created, match_keywords: created.match_keywords ?? [] };
}

function resolveAccount(
  sourceText: string,
  description: string,
  accounts: AccountLite[],
): string | null {
  const bySource = resolveAccountFromText(sourceText, accounts);
  if (bySource) return bySource;
  return resolveAccountFromText(description, accounts);
}

function resolveAccountFromText(text: string, accounts: AccountLite[]): string | null {
  const haystack = stripDiacritics(text).toLowerCase();
  if (!haystack.trim()) return null;
  const candidates: { id: string; kw: string }[] = [];
  for (const a of accounts) {
    const accountName = stripDiacritics(a.name ?? "").trim().toLowerCase();
    if (accountName) candidates.push({ id: a.id, kw: accountName });
    for (const k of a.match_keywords ?? []) {
      const kw = stripDiacritics(k ?? "").trim().toLowerCase();
      if (kw) candidates.push({ id: a.id, kw });
    }
  }
  candidates.sort((a, b) => b.kw.length - a.kw.length);
  for (const c of candidates) if (haystack.includes(c.kw)) return c.id;
  return null;
}

type TransferCandidate = { description: string | null; account_id: string; source_account_text?: string | null };

function hasDistinctSourceAccounts(a: TransferCandidate, b: TransferCandidate): boolean {
  const as = stripDiacritics(a.source_account_text ?? "").toLowerCase().trim();
  const bs = stripDiacritics(b.source_account_text ?? "").toLowerCase().trim();
  return !!as && !!bs && as !== bs;
}

function looksLikeTransferPair(a: TransferCandidate, b: TransferCandidate, accounts: AccountLite[]): boolean {
  if (hasDistinctSourceAccounts(a, b)) return true;
  const aMention = resolveAccountFromText(a.description ?? "", accounts);
  const bMention = resolveAccountFromText(b.description ?? "", accounts);
  if (a.account_id === b.account_id) return !!aMention && !!bMention && aMention !== bMention;
  if (aMention === b.account_id || bMention === a.account_id) return true;
  return false;
}

function inferTransferAccounts(
  expense: TransferCandidate,
  income: TransferCandidate,
  accounts: AccountLite[],
): { fromId: string; toId: string } | null {
  const expenseMention = resolveAccountFromText(expense.description ?? "", accounts);
  const incomeMention = resolveAccountFromText(income.description ?? "", accounts);
  if (expenseMention && incomeMention && expenseMention !== incomeMention) {
    return { fromId: incomeMention, toId: expenseMention };
  }
  let fromId = expense.account_id;
  let toId = income.account_id !== fromId ? income.account_id : null;

  if (expenseMention && expenseMention !== fromId) toId = expenseMention;
  else if (!toId && expenseMention && incomeMention && expenseMention === fromId && incomeMention !== fromId) {
    fromId = incomeMention;
    toId = expenseMention;
  } else if (!toId && incomeMention && incomeMention !== fromId) {
    fromId = incomeMention;
    toId = expense.account_id;
  }

  if (!toId || fromId === toId) return null;
  return { fromId, toId };
}

/* ==================== rules ==================== */

function applyRules(description: string, kind: "income" | "expense", rules: any[]): string | null {
  const d = description.toLowerCase();
  for (const r of rules) {
    if (!r.enabled) continue;
    const appliesTo = r.applies_to ?? "any";
    if (appliesTo !== "any" && appliesTo !== kind) continue;
    const raw = (r.match_value ?? "").trim();
    if (!raw) continue;
    try {
      if (r.match_type === "contains") {
        // multi-term: split by comma, ALL terms must be present
        const terms = raw.toLowerCase().split(",").map((t: string) => t.trim()).filter(Boolean);
        if (terms.length && terms.every((t: string) => d.includes(t))) return r.category_id;
      } else if (r.match_type === "equals") {
        if (d === raw.toLowerCase()) return r.category_id;
      } else if (r.match_type === "regex") {
        if (new RegExp(raw, "i").test(description)) return r.category_id;
      }
    } catch { /* invalid regex */ }
  }
  return null;
}

/* ==================== server fns ==================== */

const MappingSchema = z.object({
  date: z.number().int(),
  description: z.number().int(),
  amount: z.number().int(),
  external_id: z.number().int().nullable().optional(),
  source_account: z.number().int().nullable().optional(),
  status: z.number().int().nullable().optional(),
});

export const inspectCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    csv_text: z.string().min(1).max(5_000_000),
  }).parse(d))
  .handler(async ({ data }) => {
    const rows = parseCSV(data.csv_text);
    if (rows.length < 1) return { headers: [], sample: [], total: 0, suggested: null as null | { provider: string; mapping: ColumnMapping } };
    const headers = rows[0];
    const sample = rows.slice(1, 6);
    const { provider, mapping } = autoDetect(headers);
    return { headers, sample, total: rows.length - 1, suggested: { provider, mapping } };
  });

export const previewCsvImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    csv_text: z.string().min(1).max(5_000_000),
    mapping: MappingSchema.optional(),
    provider_name: z.string().trim().min(1).max(50).optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;

    const { data: accountsRaw } = await supabase
      .from("accounts").select("id, name, currency, match_keywords")
      .eq("user_id", userId).eq("archived", false);
    const accountsAll: AccountLite[] = (accountsRaw ?? []).map((a: any) => ({
      id: a.id, name: a.name, currency: a.currency, match_keywords: a.match_keywords ?? [],
    }));
    // Exclude the Pendentes holding account from keyword matching
    const accounts = accountsAll.filter((a) => a.name !== PENDING_ACCOUNT_NAME);

    const rows = parseCSV(data.csv_text);
    let provider: string = data.provider_name ?? "generic";
    let mapping: ColumnMapping;
    if (data.mapping) {
      mapping = {
        ...data.mapping,
        external_id: data.mapping.external_id ?? null,
        source_account: data.mapping.source_account ?? null,
        status: data.mapping.status ?? null,
      };
    } else {
      const det = autoDetect(rows[0] ?? []);
      mapping = det.mapping;
      if (!data.provider_name) provider = det.provider;
    }
    if (mapping.date < 0 || mapping.amount < 0) {
      throw new Error("Mapeamento incompleto: data e valor são obrigatórios.");
    }
    const parsed = parseWithMapping(rows, mapping);

    // Resolve account per row (null = unmatched → will route to Pendentes)
    type Resolved = ParsedRow & { account_id: string | null };
    const resolvedRaw: Resolved[] = parsed.map((p) => ({
      ...p,
      account_id: resolveAccount(p.source_account_text, p.description, accounts),
    }));

    // For unmatched rows that have a distinct source_account_text, auto-create
    // a placeholder account per unique source label so transfer-pair detection
    // can tell the two sides apart (otherwise both sides land on Pendentes
    // and look like a same-account pair, which we skip).
    const accMap = new Map<string, AccountLite>(accountsAll.map((a) => [a.id, a]));
    const unmatchedSources = new Map<string, string>(); // norm key -> account_id
    const normSrc = (s: string) => s.trim().toLowerCase();
    const needsBucketBySrc = new Set<string>();
    for (const r of resolvedRaw) {
      if (r.account_id !== null) continue;
      const key = normSrc(r.source_account_text || "");
      if (key) needsBucketBySrc.add(key);
    }
    // Reuse already-existing accounts that share the same name as the source label
    for (const key of needsBucketBySrc) {
      const existing = accountsAll.find((a) => a.name.trim().toLowerCase() === key);
      if (existing) unmatchedSources.set(key, existing.id);
    }
    // Create the rest
    for (const r of resolvedRaw) {
      if (r.account_id !== null) continue;
      const key = normSrc(r.source_account_text || "");
      if (!key || unmatchedSources.has(key)) continue;
      const name = r.source_account_text.trim().slice(0, 80);
      const { data: created, error } = await supabase
        .from("accounts").insert({
          user_id: userId,
          name,
          currency: "BRL",
          color: "oklch(0.7 0.14 75)",
          position: 900,
          match_keywords: [name],
        }).select("id, name, currency, match_keywords").single();
      if (error) throw new Error("Falha ao criar conta '" + name + "': " + error.message);
      const lite: AccountLite = { ...created, match_keywords: created.match_keywords ?? [] };
      accMap.set(lite.id, lite);
      unmatchedSources.set(key, lite.id);
    }

    // Pendentes is only for rows with NO source_account_text at all
    const stillUnmatched = resolvedRaw.some((r) => r.account_id === null && !normSrc(r.source_account_text || ""));
    let pending: AccountLite | null = accountsAll.find((a) => a.name === PENDING_ACCOUNT_NAME) ?? null;
    if (stillUnmatched && !pending) pending = await getOrCreatePendingAccount(supabase, userId);
    if (pending) accMap.set(pending.id, pending);

    const resolved = resolvedRaw.map((r) => {
      if (r.account_id) return { ...r, account_id: r.account_id, _unmatched: false };
      const key = normSrc(r.source_account_text || "");
      const auto = key ? unmatchedSources.get(key) : undefined;
      return { ...r, account_id: auto ?? pending!.id, _unmatched: true };
    });

    // Detect transfer pairs within the file:
    // same date, same abs amount, opposite sign, and either different source
    // accounts or descriptions that point to another known account.
    type Item = {
      idx: number;
      date: string;
      description: string;
      amount: number;
      kind: "income" | "expense" | "transfer";
      external_id: string | null;
      duplicate: boolean;
      category_id: string | null;
      needs_review: boolean;
      account_id: string;
      account_name: string;
      to_account_id?: string | null;
      to_account_name?: string | null;
    };

    const usedIdx = new Set<number>();
    const items: Item[] = [];
    const round = (n: number) => Math.round(n * 100) / 100;

    for (let i = 0; i < resolved.length; i++) {
      if (usedIdx.has(i)) continue;
      const a = resolved[i];
      // search for a matching opposite row
      let pairIdx = -1;
      for (let j = i + 1; j < resolved.length; j++) {
        if (usedIdx.has(j)) continue;
        const b = resolved[j];
        if (b.date !== a.date) continue;
        if (round(b.amount) !== -round(a.amount)) continue;
        if (!looksLikeTransferPair(a, b, accountsAll)) continue;
        pairIdx = j; break;
      }
      if (pairIdx >= 0) {
        const b = resolved[pairIdx];
        // expense side is "from", income side is "to"
        const fromRow = a.amount < 0 ? a : b;
        const toRow = a.amount < 0 ? b : a;
        const inferred = inferTransferAccounts(fromRow, toRow, accountsAll);
        if (!inferred) continue;
        usedIdx.add(i); usedIdx.add(pairIdx);
        const fromAcc = accMap.get(inferred.fromId)!;
        const toAcc = accMap.get(inferred.toId)!;
        items.push({
          idx: i,
          date: a.date,
          description: fromRow.description || toRow.description || `Transferência ${fromAcc.name} → ${toAcc.name}`,
          amount: Math.abs(a.amount),
          kind: "transfer",
          external_id: fromRow.external_id ?? toRow.external_id ?? null,
          duplicate: false,
          category_id: null,
          needs_review: false,
          account_id: fromAcc.id,
          account_name: fromAcc.name,
          to_account_id: toAcc.id,
          to_account_name: toAcc.name,
        });
      }
    }

    // Remaining as regular income/expense
    const remaining = resolved.map((r, i) => ({ r, i })).filter(({ i }) => !usedIdx.has(i));

    const { data: rules } = await supabase.from("category_rules").select("*").eq("user_id", userId).eq("enabled", true).order("position");
    const { data: cats } = await supabase.from("categories").select("id, name, kind");

    // Dedup check by (account_id, external_id)
    const dupKeys = new Set<string>();
    {
      const byAccount = new Map<string, string[]>();
      for (const { r } of remaining) {
        if (!r.external_id) continue;
        const arr = byAccount.get(r.account_id) ?? [];
        arr.push(r.external_id);
        byAccount.set(r.account_id, arr);
      }
      // Also include transfer external ids
      for (const it of items) {
        if (!it.external_id) continue;
        const arr = byAccount.get(it.account_id) ?? [];
        arr.push(it.external_id);
        byAccount.set(it.account_id, arr);
      }
      for (const [accId, ids] of byAccount) {
        const { data: ex } = await supabase
          .from("transactions").select("external_id")
          .eq("user_id", userId).eq("account_id", accId).in("external_id", ids);
        (ex ?? []).forEach((e: any) => { if (e.external_id) dupKeys.add(`${accId}:${e.external_id}`); });
      }
    }

    for (const { r, i } of remaining) {
      const kind: "income" | "expense" = r.amount >= 0 ? "income" : "expense";
      const matched = applyRules(r.description, kind, rules ?? []);
      let category_id: string | null = null;
      if (matched) {
        const cat = (cats ?? []).find((c: any) => c.id === matched);
        if (cat && cat.kind === kind) category_id = matched;
      }
      const acc = accMap.get(r.account_id)!;
      const unmatched = (r as any)._unmatched === true;
      items.push({
        idx: i,
        date: r.date,
        description: r.description,
        amount: Math.abs(r.amount),
        kind,
        external_id: r.external_id,
        duplicate: r.external_id ? dupKeys.has(`${r.account_id}:${r.external_id}`) : false,
        category_id: unmatched ? null : category_id,
        needs_review: unmatched || !category_id,
        account_id: acc.id,
        account_name: acc.name,
      });
    }
    // mark transfer duplicates
    for (const it of items) {
      if (it.kind === "transfer" && it.external_id) {
        it.duplicate = dupKeys.has(`${it.account_id}:${it.external_id}`);
      }
    }

    // Sort by date then idx
    items.sort((a, b) => a.date.localeCompare(b.date) || a.idx - b.idx);

    return {
      provider,
      total: items.length,
      duplicates: items.filter((i) => i.duplicate).length,
      transfers: items.filter((i) => i.kind === "transfer").length,
      unmatched: items.filter((i) => i.account_id === pending?.id).length,
      pending_account: pending ? { id: pending.id, name: pending.name } : null,
      items,
    };
  });

export const commitCsvImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    provider: z.string().trim().min(1).max(50),
    items: z.array(z.object({
      date: z.string(),
      description: z.string(),
      amount: z.number().positive(),
      kind: z.enum(["income", "expense", "transfer"]),
      category_id: z.string().uuid().nullable(),
      external_id: z.string().nullable(),
      account_id: z.string().uuid(),
      to_account_id: z.string().uuid().nullable().optional(),
    })).min(1).max(2000),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;

    const accIds = Array.from(new Set(data.items.flatMap((i) => [i.account_id, i.to_account_id]).filter(Boolean) as string[]));
    const { data: accs } = await supabase.from("accounts").select("id, currency").eq("user_id", userId).in("id", accIds);
    const curBy = new Map((accs ?? []).map((a: any) => [a.id, a.currency]));

    const rows = data.items.map((it) => ({
      user_id: userId,
      kind: it.kind,
      amount: it.amount,
      currency: curBy.get(it.account_id) ?? "BRL",
      account_id: it.account_id,
      to_account_id: it.kind === "transfer" ? (it.to_account_id ?? null) : null,
      category_id: it.kind === "transfer" ? null : it.category_id,
      description: it.description.slice(0, 200) || null,
      date: it.date,
      paid: true,
      external_id: it.external_id,
      needs_review: it.kind === "transfer" ? false : !it.category_id,
      import_source: data.provider,
    }));

    const withExt = rows.filter((r) => r.external_id);
    const withoutExt = rows.filter((r) => !r.external_id);

    let inserted = 0;
    if (withExt.length) {
      const { data: ins, error } = await supabase
        .from("transactions")
        .upsert(withExt, { onConflict: "user_id,account_id,external_id", ignoreDuplicates: true })
        .select("id");
      if (error) throw new Error(error.message);
      inserted += ins?.length ?? 0;
    }
    if (withoutExt.length) {
      const { data: ins, error } = await supabase.from("transactions").insert(withoutExt).select("id");
      if (error) throw new Error(error.message);
      inserted += ins?.length ?? 0;
    }
    return { ok: true, inserted };
  });

/* ==================== category rules CRUD ==================== */

export const listCategoryRules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("category_rules").select("*").eq("user_id", context.userId).order("position");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertCategoryRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    id: z.string().uuid().optional(),
    match_value: z.string().trim().min(1).max(200),
    match_type: z.enum(["contains", "equals", "regex"]),
    applies_to: z.enum(["any", "income", "expense"]).optional(),
    category_id: z.string().uuid(),
    enabled: z.boolean().optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const payload: any = {
      user_id: context.userId,
      match_value: data.match_value,
      match_type: data.match_type,
      applies_to: data.applies_to ?? "any",
      category_id: data.category_id,
      enabled: data.enabled ?? true,
    };
    if (data.id) payload.id = data.id;
    const { error } = await context.supabase.from("category_rules").upsert(payload);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteCategoryRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("category_rules").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const reapplyRulesToPending = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: rules } = await supabase.from("category_rules").select("*").eq("user_id", userId).eq("enabled", true).order("position");
    const { data: cats } = await supabase.from("categories").select("id, kind");
    const { data: pending } = await supabase
      .from("transactions").select("id, description, kind").eq("user_id", userId).eq("needs_review", true);
    let updated = 0;
    for (const t of pending ?? []) {
      const matched = applyRules(t.description ?? "", t.kind as "income" | "expense", rules ?? []);
      if (!matched) continue;
      const cat = (cats ?? []).find((c: any) => c.id === matched);
      if (!cat || cat.kind !== t.kind) continue;
      await supabase.from("transactions").update({ category_id: matched, needs_review: false }).eq("id", t.id);
      updated++;
    }
    return { ok: true, updated };
  });

export const resetAllTransactions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { error, count } = await supabase
      .from("transactions")
      .delete({ count: "exact" })
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true, deleted: count ?? 0 };
  });

export const reconcileTransfers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: accountsRaw } = await supabase
      .from("accounts").select("id, name, currency, match_keywords")
      .eq("user_id", userId).eq("archived", false);
    const accounts: AccountLite[] = (accountsRaw ?? []).map((a: any) => ({
      id: a.id, name: a.name, currency: a.currency, match_keywords: a.match_keywords ?? [],
    }));
    // Pull non-transfer transactions and find income/expense pairs:
    // same date, same amount, opposite kind, and account names/keywords that
    // indicate money moved between accounts.
    const { data: txs, error } = await supabase
      .from("transactions")
      .select("id, date, amount, kind, account_id, description, external_id")
      .eq("user_id", userId)
      .in("kind", ["income", "expense"]);
    if (error) throw new Error(error.message);
    const list = txs ?? [];
    const round = (n: number) => Math.round(Number(n) * 100) / 100;
    const used = new Set<string>();
    let merged = 0;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (used.has(a.id)) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (used.has(b.id)) continue;
        if (a.date !== b.date) continue;
        if (round(a.amount) !== round(b.amount)) continue;
        if (a.kind === b.kind) continue;
        if (!looksLikeTransferPair(a, b, accounts)) continue;
        const fromTx = a.kind === "expense" ? a : b;
        const toTx = a.kind === "expense" ? b : a;
        const inferred = inferTransferAccounts(fromTx, toTx, accounts);
        if (!inferred) continue;
        // Promote fromTx into a transfer, delete toTx
        const { error: e1 } = await supabase.from("transactions").update({
          kind: "transfer",
          account_id: inferred.fromId,
          to_account_id: inferred.toId,
          category_id: null,
          needs_review: false,
        }).eq("id", fromTx.id);
        if (e1) throw new Error(e1.message);
        const { error: e2 } = await supabase.from("transactions").delete().eq("id", toTx.id);
        if (e2) throw new Error(e2.message);
        used.add(a.id); used.add(b.id);
        merged++;
        break;
      }
    }
    return { ok: true, merged };
  });
