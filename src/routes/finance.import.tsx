import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { requireAuth } from "@/lib/route-guards";
import { getFinanceDashboard, listCategories } from "@/lib/finance.functions";
import { inspectCsv, previewCsvImport, commitCsvImport } from "@/lib/banking.functions";
import { Upload, AlertTriangle, CheckCircle2, FileText, ArrowDownCircle, ArrowUpCircle, Save, RotateCcw } from "lucide-react";

export const Route = createFileRoute("/finance/import")({
  beforeLoad: requireAuth,
  component: ImportPage,
});

type PreviewItem = {
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

type Mapping = {
  date: number;
  description: number;
  amount: number;
  external_id: number | null;
  source_account: number | null;
  status: number | null;
};

const BANK_PRESETS = [
  { value: "mercury", label: "Mercury" },
  { value: "wise", label: "Wise" },
  { value: "custom", label: "Outro / Personalizado" },
];

const MAPPING_KEY = (name: string) => `csv-mapping:${name.toLowerCase().trim()}`;

function loadSavedMapping(name: string): Mapping | null {
  try {
    const raw = localStorage.getItem(MAPPING_KEY(name));
    if (!raw) return null;
    const m = JSON.parse(raw);
    if (typeof m?.date === "number" && typeof m?.amount === "number") {
      return {
        date: m.date,
        description: typeof m.description === "number" ? m.description : -1,
        amount: m.amount,
        external_id: typeof m.external_id === "number" ? m.external_id : null,
        source_account: typeof m.source_account === "number" ? m.source_account : null,
        status: typeof m.status === "number" ? m.status : null,
      };
    }
  } catch { /* ignore */ }
  return null;
}

function saveMapping(name: string, m: Mapping) {
  try { localStorage.setItem(MAPPING_KEY(name), JSON.stringify(m)); } catch { /* ignore */ }
}


function ImportPage() {
  const qc = useQueryClient();
  const getDash = useServerFn(getFinanceDashboard);
  const listCat = useServerFn(listCategories);
  const inspect = useServerFn(inspectCsv);
  const preview = useServerFn(previewCsvImport);
  const commit = useServerFn(commitCsvImport);

  const dashQ = useQuery({ queryKey: ["finance-dash"], queryFn: () => getDash() });
  const catQ = useQuery({ queryKey: ["finance", "cat"], queryFn: () => listCat() });

  // no default account — unmatched rows route to auto-created "Pendentes"
  const [bankPreset, setBankPreset] = useState<string>("mercury");
  const [customName, setCustomName] = useState<string>("");
  const [csvText, setCsvText] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [step, setStep] = useState<"upload" | "mapping" | "preview">("upload");

  const [headers, setHeaders] = useState<string[]>([]);
  const [sample, setSample] = useState<string[][]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [mapping, setMapping] = useState<Mapping>({ date: -1, description: -1, amount: -1, external_id: null, source_account: null, status: null });

  const [previewData, setPreviewData] = useState<{
    provider: string;
    total: number;
    duplicates: number;
    transfers?: number;
    unmatched?: number;
    pending_account?: { id: string; name: string } | null;
    items: PreviewItem[];
  } | null>(null);
  const [skipDups, setSkipDups] = useState(true);

  const providerName = bankPreset === "custom" ? customName.trim() : bankPreset;

  const mInspect = useMutation({
    mutationFn: (d: any) => inspect({ data: d }),
    onSuccess: (data: any) => {
      setHeaders(data.headers);
      setSample(data.sample);
      setTotalRows(data.total);
      const saved = providerName ? loadSavedMapping(providerName) : null;
      if (saved) setMapping({ ...saved, status: saved.status ?? data.suggested?.mapping?.status ?? null });
      else if (data.suggested) {
        const sg = data.suggested.mapping;
        setMapping({
          date: sg.date ?? -1,
          description: sg.description ?? -1,
          amount: sg.amount ?? -1,
          external_id: sg.external_id ?? null,
          source_account: sg.source_account ?? null,
          status: sg.status ?? null,
        });
      }
      setStep("mapping");
    },
  });

  const mPreview = useMutation({
    mutationFn: (d: any) => preview({ data: d }),
    onSuccess: (data: any) => { setPreviewData(data); setStep("preview"); },
  });
  const mCommit = useMutation({
    mutationFn: (d: any) => commit({ data: d }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance", "tx"] });
      qc.invalidateQueries({ queryKey: ["finance-dash"] });
      setPreviewData(null); setCsvText(""); setFileName(""); setStep("upload");
    },
  });

  const accounts = dashQ.data?.accounts ?? [];
  const cats = catQ.data ?? [];

  const handleFile = async (f: File) => {
    setFileName(f.name);
    const text = await f.text();
    setCsvText(text);
  };

  const handleInspect = () => {
    if (!csvText || !providerName) return;
    mInspect.mutate({ csv_text: csvText });
  };

  const handleConfirmMapping = () => {
    if (mapping.date < 0 || mapping.amount < 0) return;
    if (providerName) saveMapping(providerName, mapping);
    mPreview.mutate({
      csv_text: csvText,
      mapping,
      provider_name: providerName,
    });
  };

  const updateItem = (idx: number, patch: Partial<PreviewItem>) => {
    if (!previewData) return;
    setPreviewData({
      ...previewData,
      items: previewData.items.map((it) => it.idx === idx ? { ...it, ...patch, needs_review: patch.category_id !== undefined ? !patch.category_id : it.needs_review } : it),
    });
  };

  const handleCommit = () => {
    if (!previewData) return;
    const items = previewData.items
      .filter((it) => !skipDups || !it.duplicate)
      .map((it) => ({
        date: it.date,
        description: it.description,
        amount: it.amount,
        kind: it.kind,
        category_id: it.kind === "transfer" ? null : it.category_id,
        external_id: it.external_id,
        account_id: it.account_id,
        to_account_id: it.to_account_id ?? null,
      }));
    if (items.length === 0) {
      alert("Nenhum lançamento para importar (todos foram filtrados como duplicados).");
      return;
    }
    mCommit.mutate({ provider: providerName || "generic", items });
  };


  const hasSavedMapping = useMemo(() => providerName ? !!loadSavedMapping(providerName) : false, [providerName, step]);

  return (
    <div className="space-y-5">
      {/* STEP indicator */}
      <div className="flex items-center gap-2 text-xs">
        {(["upload", "mapping", "preview"] as const).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <span className={`size-6 rounded-full grid place-items-center font-semibold ${step === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{i + 1}</span>
            <span className={step === s ? "font-semibold" : "text-muted-foreground"}>
              {s === "upload" ? "Upload" : s === "mapping" ? "Mapear colunas" : "Revisar"}
            </span>
            {i < 2 && <span className="w-6 h-px bg-border" />}
          </div>
        ))}
      </div>

      {step === "upload" && (
        <section className="rounded-2xl bg-surface border border-border p-6 space-y-4">
          <div>
            <h2 className="text-base font-semibold">Importar extrato CSV</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Escolha o banco e o arquivo CSV. As linhas vão para as contas conforme as palavras-chave configuradas. Linhas sem correspondência ficam em <span className="font-medium">⏳ Pendentes</span> para revisão posterior. O mapeamento é salvo por banco.
            </p>

          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Banco</label>
            <select value={bankPreset} onChange={(e) => setBankPreset(e.target.value)}
              className="w-full h-10 px-3 rounded-lg bg-muted border border-border text-sm outline-none focus:border-primary">
              {BANK_PRESETS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
            </select>
            {bankPreset === "custom" && (
              <input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="Nome do banco (ex: Itaú)"
                className="w-full h-10 px-3 rounded-lg bg-muted border border-border text-sm outline-none focus:border-primary mt-2" />
            )}
            {providerName && hasSavedMapping && (
              <p className="text-[11px] text-success flex items-center gap-1">
                <CheckCircle2 className="size-3" /> Mapeamento salvo para "{providerName}" — será aplicado automaticamente.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Arquivo CSV</label>
            <label className="flex items-center justify-center gap-2 h-24 rounded-lg border-2 border-dashed border-border bg-muted/50 cursor-pointer hover:border-primary transition-colors">
              <input type="file" accept=".csv,text/csv" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              <Upload className="size-5 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {fileName ? <><FileText className="inline size-4 mr-1" />{fileName}</> : "Clique para escolher um arquivo .csv"}
              </span>
            </label>
          </div>

          <button
            disabled={!csvText || !providerName || mInspect.isPending}
            onClick={handleInspect}
            className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-50"
          >
            {mInspect.isPending ? "Analisando…" : "Próximo: mapear colunas"}
          </button>

          {mInspect.isError && (
            <div className="text-sm text-destructive">{(mInspect.error as Error).message}</div>
          )}
        </section>
      )}

      {step === "mapping" && (
        <section className="rounded-2xl bg-surface border border-border p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold">Mapear colunas — {providerName}</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Selecione qual coluna do CSV corresponde a cada campo. {totalRows} linhas detectadas.
                Esse mapeamento será salvo e reaplicado nas próximas importações deste banco.
              </p>
            </div>
            <button onClick={() => setStep("upload")} className="h-8 px-3 rounded-lg bg-muted text-xs">Voltar</button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {([
              { key: "date", label: "Data *" },
              { key: "amount", label: "Valor *" },
              { key: "description", label: "Descrição" },
              { key: "external_id", label: "ID único (evita duplicatas)" },
              { key: "source_account", label: "Conta de origem (para roteamento por palavra-chave)" },
              { key: "status", label: "Status (ignora falhadas/canceladas)" },
            ] as const).map((f) => (
              <div key={f.key} className="space-y-1">
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{f.label}</label>
                <select
                  value={String((mapping as any)[f.key] ?? -1)}
                  onChange={(e) => setMapping((m) => ({
                    ...m,
                    [f.key]: e.target.value === "-1"
                      ? (f.key === "external_id" || f.key === "source_account" || f.key === "status" ? null : -1)
                      : parseInt(e.target.value, 10),
                  }))}
                  className="w-full h-10 px-3 rounded-lg bg-muted border border-border text-sm outline-none focus:border-primary"
                >
                  <option value="-1">— não mapeado —</option>
                  {headers.map((h, i) => <option key={i} value={i}>{h || `(coluna ${i + 1})`}</option>)}
                </select>
              </div>
            ))}
          </div>

          <p className="text-[11px] text-muted-foreground -mt-2">
            Quando a coluna "Conta de origem" estiver mapeada, o sistema usa as palavras-chave de cada conta (configuradas em <span className="font-medium">Contas</span>) para enviar cada lançamento à conta correta. Transferências entre contas são detectadas automaticamente. Rows não identificadas vão para a conta padrão selecionada.
          </p>

          <div className="rounded-xl border border-border overflow-hidden">
            <div className="px-3 py-2 bg-muted/50 text-[10px] uppercase tracking-wider text-muted-foreground">
              Pré-visualização (primeiras {sample.length} linhas)
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    {headers.map((h, i) => {
                      const role =
                        i === mapping.date ? "Data" :
                        i === mapping.amount ? "Valor" :
                        i === mapping.description ? "Descrição" :
                        i === mapping.external_id ? "ID" :
                        i === mapping.source_account ? "Conta" :
                        i === mapping.status ? "Status" : null;
                      return (
                        <th key={i} className="text-left px-3 py-2 font-medium whitespace-nowrap">
                          <div>{h || `Col ${i + 1}`}</div>
                          {role && <div className="text-[9px] uppercase tracking-wider text-primary mt-0.5">→ {role}</div>}
                        </th>
                      );
                    })}
                  </tr>
                </thead>

                <tbody>
                  {sample.map((row, r) => (
                    <tr key={r} className="border-b border-border last:border-0">
                      {headers.map((_, i) => (
                        <td key={i} className="px-3 py-2 text-muted-foreground whitespace-nowrap">{row[i] ?? ""}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              disabled={mapping.date < 0 || mapping.amount < 0 || mPreview.isPending}
              onClick={handleConfirmMapping}
              className="h-11 flex-1 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Save className="size-4" />
              {mPreview.isPending ? "Processando…" : "Salvar mapeamento e pré-visualizar"}
            </button>
            {providerName && hasSavedMapping && (
              <button
                onClick={() => { try { localStorage.removeItem(MAPPING_KEY(providerName)); } catch {} setMapping({ date: -1, description: -1, amount: -1, external_id: null, source_account: null, status: null }); }}
                className="h-11 px-4 rounded-xl bg-muted text-xs flex items-center gap-2"
                title="Limpar mapeamento salvo"
              >
                <RotateCcw className="size-4" /> Limpar
              </button>
            )}
          </div>

          {mPreview.isError && (
            <div className="text-sm text-destructive">{(mPreview.error as Error).message}</div>
          )}
        </section>
      )}

      {step === "preview" && previewData && (
        <>
          <section className="rounded-2xl bg-surface border border-border p-5 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Banco: </span>
                <span className="font-semibold capitalize">{previewData.provider}</span>
              </div>
              {(previewData.unmatched ?? 0) > 0 && (
                <>
                  <div className="h-4 w-px bg-border" />
                  <div className="text-warning">
                    <span className="font-semibold">{previewData.unmatched}</span> sem conta → <span className="font-medium">{previewData.pending_account?.name ?? "Pendentes"}</span>
                  </div>
                </>
              )}
              <div className="h-4 w-px bg-border" />
              <div><span className="font-semibold">{previewData.total}</span> <span className="text-muted-foreground">linhas</span></div>
              {(previewData.transfers ?? 0) > 0 && (
                <div className="text-primary"><span className="font-semibold">{previewData.transfers}</span> transferência(s)</div>
              )}
              {previewData.duplicates > 0 && (
                <div className="text-warning"><span className="font-semibold">{previewData.duplicates}</span> duplicadas</div>
              )}
              <div><span className="font-semibold text-warning">{previewData.items.filter((i) => i.needs_review).length}</span> <span className="text-muted-foreground">pendentes</span></div>

            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={skipDups} onChange={(e) => setSkipDups(e.target.checked)} className="accent-primary" />
                Pular duplicadas
              </label>
              <button onClick={() => setStep("mapping")} className="h-9 px-4 rounded-lg bg-muted text-xs font-medium">Voltar</button>
              <button
                disabled={mCommit.isPending}
                onClick={handleCommit}
                className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-semibold flex items-center gap-2 disabled:opacity-50"
              >
                <CheckCircle2 className="size-4" />
                {mCommit.isPending ? "Importando…" : `Importar ${previewData.items.filter((i) => !skipDups || !i.duplicate).length}`}
              </button>
            </div>
          </section>

          <section className="rounded-2xl bg-surface border border-border overflow-hidden">
            <div className="max-h-[60vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="text-left px-4 py-2 font-medium">Data</th>
                    <th className="text-left px-4 py-2 font-medium">Descrição</th>
                    <th className="text-left px-4 py-2 font-medium">Conta</th>
                    <th className="text-right px-4 py-2 font-medium">Valor</th>
                    <th className="text-left px-4 py-2 font-medium">Categoria</th>
                    <th className="text-left px-4 py-2 font-medium w-20">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {previewData.items.map((it) => {
                    const isTransfer = it.kind === "transfer";
                    const availableCats = isTransfer ? [] : cats.filter((c: any) => c.kind === it.kind);
                    const Icon = isTransfer ? ArrowUpCircle : it.kind === "income" ? ArrowDownCircle : ArrowUpCircle;
                    const color = isTransfer ? "oklch(0.6 0.22 285)" : it.kind === "income" ? "oklch(0.62 0.14 155)" : "oklch(0.65 0.16 25)";
                    return (
                      <tr key={it.idx} className={`border-t border-border ${it.duplicate && skipDups ? "opacity-40" : ""}`}>
                        <td className="px-4 py-2 text-[11px] tabular-nums text-muted-foreground">
                          {new Date(it.date + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                        </td>
                        <td className="px-4 py-2 max-w-md">
                          <div className="flex items-center gap-2">
                            <Icon className="size-4 shrink-0" style={{ color }} />
                            <span className="truncate">{it.description || <em className="text-muted-foreground">sem descrição</em>}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2 text-[11px]">
                          {isTransfer ? (
                            <span className="inline-flex items-center gap-1">
                              <span className="font-medium">{it.account_name}</span>
                              <span className="text-muted-foreground">→</span>
                              <span className="font-medium">{it.to_account_name}</span>
                            </span>
                          ) : (
                            <span className="font-medium">{it.account_name}</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums font-medium" style={{ color: it.kind === "income" || isTransfer ? color : undefined }}>
                          {isTransfer ? "↔" : it.kind === "expense" ? "−" : "+"}{it.amount.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-4 py-2">
                          {isTransfer ? (
                            <span className="text-[10px] uppercase tracking-wider text-primary">transferência</span>
                          ) : (
                            <select value={it.category_id ?? ""} onChange={(e) => updateItem(it.idx, { category_id: e.target.value || null })}
                              className={`h-8 px-2 rounded-md bg-muted border text-xs outline-none w-full max-w-[180px] ${it.needs_review ? "border-warning/50" : "border-border"}`}>
                              <option value="">— sem categoria —</option>
                              {availableCats.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          {it.duplicate ? (
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">duplicada</span>
                          ) : it.needs_review ? (
                            <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-warning">
                              <AlertTriangle className="size-3" /> revisar
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-success">
                              <CheckCircle2 className="size-3" /> ok
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

          </section>
        </>
      )}

      {mCommit.isError && (
        <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
          Erro ao importar: {(mCommit.error as Error).message}
        </div>
      )}

      {mCommit.isSuccess && (
        <div className="rounded-xl bg-success/10 border border-success/30 p-4 text-sm flex items-center gap-2">
          <CheckCircle2 className="size-4 text-success" />
          Importação concluída. {mCommit.data?.inserted ?? 0} lançamentos inseridos.
        </div>
      )}
    </div>
  );
}
