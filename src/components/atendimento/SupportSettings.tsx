import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Loader2, Plug, PenLine } from "lucide-react";
import { getSupportSettings, saveSupportSettings, type getZohoStatus } from "@/lib/atendimento.functions";
import { Switch } from "@/components/ui/switch";
import { ConnectZoho } from "./ConnectZoho";
import { fullTime } from "./utils";
import { useSupportFn } from "./demo";

export type ConfigTab = "integracao" | "assinatura";
type ZohoStatus = Awaited<ReturnType<typeof getZohoStatus>>;

// Atendimento > Configurações: conexão com o Zoho (admin) e assinatura dos e-mails.
export function SupportSettings({ status, tab, setTab }: { status: ZohoStatus; tab: ConfigTab; setTab: (t: ConfigTab) => void }) {
  const TABS: { key: ConfigTab; label: string; desc: string; icon: typeof Plug }[] = [
    { key: "integracao", label: "Integração", desc: "Conta do Zoho Mail", icon: Plug },
    { key: "assinatura", label: "Assinatura", desc: "Fim dos e-mails enviados", icon: PenLine },
  ];
  return (
    <div className="grid md:grid-cols-[220px_minmax(0,1fr)] gap-4 items-start">
      <nav className="rounded-2xl border border-border bg-card p-2 flex md:flex-col gap-1">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 md:flex-none flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-colors ${tab === t.key ? "bg-primary/10 text-primary" : "hover:bg-muted text-foreground"}`}>
            <t.icon className="size-4 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium">{t.label}</p>
              <p className="hidden md:block text-[11px] text-muted-foreground truncate">{t.desc}</p>
            </div>
          </button>
        ))}
      </nav>
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 max-w-2xl">
        {tab === "integracao" ? <Integration status={status} /> : <Signature />}
      </div>
    </div>
  );
}

function Integration({ status }: { status: ZohoStatus }) {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["zoho-status"] });
    qc.invalidateQueries({ queryKey: ["support-list"] });
  };
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold">Integração com o Zoho Mail</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Os e-mails da conta conectada aparecem na Caixa de entrada e as respostas saem por ela.</p>
      </div>

      {status.connected && (
        <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${status.lastSyncError ? "border-destructive/30 bg-destructive/5" : "border-success/30 bg-success/5"}`}>
          {status.lastSyncError
            ? <AlertTriangle className="size-4 text-destructive mt-0.5 shrink-0" />
            : <CheckCircle2 className="size-4 text-success mt-0.5 shrink-0" />}
          <div className="min-w-0 text-xs space-y-0.5">
            <p className="text-sm font-medium truncate">{status.email}</p>
            <p className="text-muted-foreground">
              Última sincronização: {status.lastSyncAt ? fullTime(status.lastSyncAt) : "ainda não sincronizou"}
            </p>
            {status.lastSyncError && <p className="text-destructive">{status.lastSyncError}</p>}
          </div>
        </div>
      )}

      {status.isAdmin ? (
        <ConnectZoho redirectUri={status.redirectUri} connectedEmail={status.connected ? status.email : null} onDone={refresh} />
      ) : !status.connected && (
        <p className="text-sm text-muted-foreground">Só o administrador pode conectar a conta do Zoho Mail.</p>
      )}
    </div>
  );
}

function Signature() {
  const qc = useQueryClient();
  const getFn = useSupportFn(getSupportSettings, "getSupportSettings");
  const saveFn = useSupportFn(saveSupportSettings, "saveSupportSettings");
  const q = useQuery({ queryKey: ["support-settings"], queryFn: () => getFn() });
  const [text, setText] = useState("");
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    if (q.data) { setText(q.data.signature); setEnabled(q.data.signatureEnabled); }
  }, [q.data]);

  const save = useMutation({
    mutationFn: () => saveFn({ data: { signature: text, signatureEnabled: enabled } }),
    onSuccess: () => { toast.success("Assinatura salva"); qc.invalidateQueries({ queryKey: ["support-settings"] }); },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar"),
  });

  if (q.isLoading) return <div className="grid place-items-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  const dirty = !!q.data && (text !== q.data.signature || enabled !== q.data.signatureEnabled);
  const preview = text.replace(/\{nome\}/gi, q.data?.senderName || "Seu nome");

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Assinatura</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Adicionada no fim de todo e-mail enviado pelo Atendimento. Dá para desligar em cada envio.</p>
        </div>
        <label className="flex items-center gap-2 text-xs font-medium shrink-0 cursor-pointer">
          <Switch checked={enabled} onCheckedChange={setEnabled} /> {enabled ? "Ligada" : "Desligada"}
        </label>
      </div>

      <div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          maxLength={2000}
          disabled={!enabled}
          placeholder={"Atenciosamente,\n{nome}\nEquipe de Atendimento\nsuporte@sualoja.com"}
          className="w-full resize-y rounded-xl border border-border bg-background p-3 text-sm outline-none focus:border-primary disabled:opacity-50"
        />
        <p className="text-[11px] text-muted-foreground mt-1">
          Use <button type="button" onClick={() => setText((t) => `${t}{nome}`)} className="font-mono text-primary hover:underline">{"{nome}"}</button> para o nome de quem está respondendo.
        </p>
      </div>

      {enabled && text.trim() && (
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground mb-1.5">Prévia</p>
          <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm">
            <p className="text-muted-foreground/70 italic">…sua resposta aqui.</p>
            <p className="mt-3 whitespace-pre-wrap text-muted-foreground">{preview}</p>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <button onClick={() => save.mutate()} disabled={!dirty || save.isPending}
          className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5 disabled:opacity-50">
          {save.isPending && <Loader2 className="size-4 animate-spin" />} Salvar assinatura
        </button>
      </div>
    </div>
  );
}
