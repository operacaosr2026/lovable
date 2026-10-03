import { Fragment, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Bot, Check, CheckCircle2, ChevronDown, Loader2, MessageSquareText, Pencil, Plug, PenLine, Plus, Sparkles, Tag, Target, Trash2, X } from "lucide-react";
import {
  changeSupportTag, getSupportSettings, saveSupportSettings, setZohoSendAs, listSupportTemplates, saveSupportTemplate, deleteSupportTemplate, getSupportTraining, previewSupportAutoReply,
  type getZohoStatus, type SupportTemplate,
} from "@/lib/atendimento.functions";
import { TemplateEditor, type TemplateDraft } from "./Composer";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { tagTone } from "./CustomerPanel";
import { useSupportTags } from "./useSupportTags";
import { Switch } from "@/components/ui/switch";
import { ConnectZoho } from "./ConnectZoho";
import { fullTime } from "./utils";
import { BUSINESS_TIMEZONES, DEFAULT_BUSINESS_HOURS, businessHoursLabel, type BusinessHours } from "@/lib/support-kpis";
import { useSupportFn } from "./demo";

export type ConfigTab = "integracao" | "assinatura" | "mensagens" | "tags" | "metas" | "autoresposta" | "treino";
type ZohoStatus = Awaited<ReturnType<typeof getZohoStatus>>;

// Atendimento > Configurações: conexão com o Zoho (admin) e assinatura dos e-mails.
export function SupportSettings({ status, tab, setTab }: { status: ZohoStatus; tab: ConfigTab; setTab: (t: ConfigTab) => void }) {
  const TABS: { key: ConfigTab; label: string; desc: string; icon: typeof Plug }[] = [
    { key: "integracao", label: "Integração", desc: "Conta do Zoho Mail", icon: Plug },
    { key: "assinatura", label: "Assinatura", desc: "Fim dos e-mails enviados", icon: PenLine },
    { key: "mensagens", label: "Mensagens salvas", desc: "Respostas prontas", icon: MessageSquareText },
    { key: "tags", label: "Tags", desc: "Etiquetas das conversas", icon: Tag },
    { key: "metas", label: "Metas", desc: "Horário comercial e tempos-alvo", icon: Target },
    { key: "autoresposta", label: "Resposta automática", desc: "E-mails de rastreio", icon: Bot },
    { key: "treino", label: "Treino da IA", desc: "Placar e o que a IA aprendeu", icon: Sparkles },
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
        {tab === "integracao" ? <Integration status={status} /> : tab === "mensagens" ? <TemplatesSettings /> : tab === "tags" ? <TagsSettings /> : tab === "metas" ? <GoalsSettings /> : tab === "autoresposta" ? <AutoReplySettings /> : tab === "treino" ? <TrainingPanel /> : <Signature />}
      </div>
    </div>
  );
}

// Remetente das respostas e mensagens novas: um dos endereços que a conta do
// Zoho pode usar (principal, apelido ou liberado em "Enviar e-mail como").
function SendAs({ status, onChanged }: { status: ZohoStatus; onChanged: () => void }) {
  const setFn = useSupportFn(setZohoSendAs, "setZohoSendAs");
  const options = status.sendAsOptions ?? [];
  const save = useMutation({
    mutationFn: (send_as: string) => setFn({ data: { send_as } }),
    onSuccess: () => { toast.success("Remetente atualizado"); onChanged(); },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar"),
  });
  return (
    <div className="rounded-xl border border-border px-4 py-3 space-y-1.5">
      <label className="text-sm font-medium">Enviar como</label>
      <p className="text-xs text-muted-foreground">Todas as respostas e mensagens novas saem por este endereço.</p>
      {status.isAdmin && options.length > 1 ? (
        <select value={status.sendAs ?? ""} disabled={save.isPending} onChange={(e) => save.mutate(e.target.value)}
          className="w-full h-9 px-3 rounded-lg bg-background border border-border text-sm outline-none focus:border-primary">
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <p className="text-sm font-mono">{status.sendAs ?? status.email}</p>
      )}
      {status.isAdmin && (
        <p className="text-[11px] text-muted-foreground">Para usar outro endereço, libere-o no Zoho em Configurações → Contas de e-mail → Enviar e-mail como, e sincronize.</p>
      )}
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

      {status.connected && <SendAs status={status} onChanged={refresh} />}

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
          placeholder={"Best regards,\n{nome}\nCustomer Support\nsupport@yourstore.com"}
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

// Mensagens salvas: as mesmas do botão "Mensagens salvas" da resposta.
function TemplatesSettings() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const listFn = useSupportFn(listSupportTemplates, "listSupportTemplates");
  const saveFn = useSupportFn(saveSupportTemplate, "saveSupportTemplate");
  const deleteFn = useSupportFn(deleteSupportTemplate, "deleteSupportTemplate");
  const [editing, setEditing] = useState<TemplateDraft | null>(null);

  const list = useQuery({ queryKey: ["support-templates"], queryFn: () => listFn() as Promise<SupportTemplate[]> });
  const refresh = () => qc.invalidateQueries({ queryKey: ["support-templates"] });
  const save = useMutation({
    mutationFn: (t: TemplateDraft) => saveFn({ data: { id: t.id, title: t.title.trim(), body: t.body.trim() } }),
    onSuccess: () => { toast.success("Mensagem salva"); setEditing(null); refresh(); },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => { toast.success("Mensagem excluída"); refresh(); },
    onError: (e: any) => toast.error(e.message ?? "Erro ao excluir"),
  });
  const askRemove = async (t: SupportTemplate) => {
    if (await confirm({ title: `Excluir a mensagem "${t.title}"?`, confirmText: "Excluir", variant: "destructive" })) remove.mutate(t.id);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Mensagens salvas</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Respostas prontas para usar no botão "Mensagens salvas" da resposta e da Nova mensagem.
          </p>
        </div>
        {!editing && (
          <button onClick={() => setEditing({ title: "", body: "" })}
            className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5 shrink-0">
            <Plus className="size-4" /> Nova
          </button>
        )}
      </div>

      {editing && (
        <div className="rounded-xl border border-primary/40 bg-primary/[0.03] p-4">
          <TemplateEditor value={editing} onChange={setEditing} saving={save.isPending} rows={10}
            onSave={() => save.mutate(editing)} onCancel={() => setEditing(null)} />
        </div>
      )}

      {list.isLoading ? (
        <div className="py-8 grid place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
      ) : !list.data?.length ? (
        !editing && <p className="text-sm text-muted-foreground rounded-xl border border-dashed border-border p-6 text-center">Nenhuma mensagem salva ainda.</p>
      ) : (
        <div className="space-y-2">
          {list.data.map((t) => (
            <div key={t.id} className="rounded-xl border border-border p-3 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{t.title}</p>
                <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-line mt-0.5">{t.body}</p>
              </div>
              <div className="flex shrink-0">
                <button onClick={() => setEditing({ id: t.id, title: t.title, body: t.body })} title="Editar"
                  className="size-8 rounded-lg grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted">
                  <Pencil className="size-4" />
                </button>
                <button onClick={() => askRemove(t)} title="Excluir"
                  className="size-8 rounded-lg grid place-items-center text-muted-foreground hover:text-destructive hover:bg-muted">
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TagsSettings() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { fixed, isLoading, aiTagsEnabled, aiAvailable } = useSupportTags();
  const saveFn = useSupportFn(saveSupportSettings, "saveSupportSettings");
  const changeFn = useSupportFn(changeSupportTag, "changeSupportTag");
  const [newTag, setNewTag] = useState("");
  const [editing, setEditing] = useState<{ from: string; to: string } | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["support-settings"] });
    qc.invalidateQueries({ queryKey: ["support-list"] });
    qc.invalidateQueries({ queryKey: ["support-conv"] });
  };
  const add = useMutation({
    mutationFn: async () => {
      const tag = newTag.trim();
      if (!tag) return;
      if (fixed.some((t) => t.toLowerCase() === tag.toLowerCase())) throw new Error("Essa tag já existe");
      await saveFn({ data: { tags: [...fixed, tag] } });
    },
    onSuccess: () => { setNewTag(""); refresh(); },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar"),
  });
  const toggleAi = useMutation({
    mutationFn: (on: boolean) => saveFn({ data: { aiTagsEnabled: on } }),
    onSuccess: (_r, on) => { toast.success(on ? "Tags automáticas ligadas" : "Tags automáticas desligadas"); refresh(); },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar"),
  });
  const change = useMutation({
    mutationFn: (v: { from: string; to: string | null }) => changeFn({ data: v }),
    onSuccess: (r: any, v) => {
      setEditing(null);
      refresh();
      toast.success(v.to ? "Tag renomeada" : "Tag apagada", r?.conversations ? { description: `${r.conversations} conversa${r.conversations > 1 ? "s" : ""} atualizada${r.conversations > 1 ? "s" : ""}` } : undefined);
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar"),
  });

  const rename = () => {
    if (!editing) return;
    const to = editing.to.trim();
    if (!to || to === editing.from) return setEditing(null);
    if (fixed.some((t) => t !== editing.from && t.toLowerCase() === to.toLowerCase())) return toast.error("Já existe uma tag com esse nome");
    change.mutate({ from: editing.from, to });
  };
  const remove = async (tag: string) => {
    if (await confirm({ title: `Apagar a tag "${tag}"?`, description: "Ela sai da lista e de todas as conversas que estão com ela.", confirmText: "Apagar", variant: "destructive" })) {
      change.mutate({ from: tag, to: null });
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold">Tags</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Sempre aparecem como sugestão nas conversas e nos filtros. Tag nova criada numa conversa entra aqui sozinha.</p>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
        <Sparkles className="size-4 text-primary mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Tags automáticas com IA</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {aiAvailable
              ? "Cada e-mail novo de cliente é lido pela IA e recebe as tags desta lista que combinarem (marcadas com ✨). Só acrescenta — nunca tira tag."
              : "Falta configurar a chave da API da Anthropic (ANTHROPIC_API_KEY) no servidor."}
          </p>
        </div>
        <Switch checked={aiAvailable && aiTagsEnabled} disabled={!aiAvailable || toggleAi.isPending} onCheckedChange={(on) => toggleAi.mutate(on)} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); add.mutate(); }} className="flex gap-2">
        <input value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="Nova tag" maxLength={40}
          className="flex-1 h-9 px-3 rounded-lg bg-background border border-border text-sm outline-none focus:border-primary" />
        <button type="submit" disabled={!newTag.trim() || add.isPending}
          className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5 disabled:opacity-50">
          {add.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Adicionar
        </button>
      </form>

      {isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-10 rounded-lg bg-muted animate-pulse" />)}</div>
      ) : !fixed.length ? (
        <p className="text-sm text-muted-foreground text-center py-6">Nenhuma tag cadastrada.</p>
      ) : (
        <div className="rounded-xl border border-border divide-y divide-border">
          {fixed.map((t) => (
            <div key={t} className="flex items-center gap-2 px-3 h-11">
              {editing?.from === t ? (
                <>
                  <input autoFocus value={editing.to} onChange={(e) => setEditing({ from: t, to: e.target.value })} maxLength={40}
                    onKeyDown={(e) => { if (e.key === "Enter") rename(); if (e.key === "Escape") setEditing(null); }}
                    className="flex-1 h-8 px-2.5 rounded-lg bg-background border border-primary text-sm outline-none" />
                  <button onClick={rename} disabled={change.isPending} className="size-8 rounded-lg grid place-items-center text-success hover:bg-success/10" aria-label="Salvar">
                    {change.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                  </button>
                  <button onClick={() => setEditing(null)} className="size-8 rounded-lg grid place-items-center text-muted-foreground hover:bg-muted" aria-label="Cancelar">
                    <X className="size-4" />
                  </button>
                </>
              ) : (
                <>
                  <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${tagTone(t, fixed)}`}>{t}</span>
                  <div className="flex-1" />
                  <button onClick={() => setEditing({ from: t, to: t })} className="size-8 rounded-lg grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted" aria-label={`Renomear ${t}`}>
                    <Pencil className="size-3.5" />
                  </button>
                  <button onClick={() => remove(t)} className="size-8 rounded-lg grid place-items-center text-muted-foreground hover:text-destructive hover:bg-destructive/10" aria-label={`Apagar ${t}`}>
                    <Trash2 className="size-3.5" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Metas dos cards do KPI: tempo de 1ª resposta e de resolução.
type Unit = "min" | "h";
const toUnit = (min: number): { value: string; unit: Unit } =>
  min % 60 === 0 && min >= 60 ? { value: String(min / 60), unit: "h" } : { value: String(min), unit: "min" };

// Resposta automática pra e-mail com tag Rastreio (support-autoreply.server.ts).
function AutoReplySettings() {
  const qc = useQueryClient();
  const getFn = useSupportFn(getSupportSettings, "getSupportSettings");
  const saveFn = useSupportFn(saveSupportSettings, "saveSupportSettings");
  const q = useQuery({ queryKey: ["support-settings"], queryFn: () => getFn() });
  const on = !!(q.data as any)?.autoReplyTracking;
  const aiAvailable = !!(q.data as any)?.aiAvailable;
  const toggle = useMutation({
    mutationFn: (v: boolean) => saveFn({ data: { autoReplyTracking: v } }),
    onSuccess: (_r, v) => { toast.success(v ? "Resposta automática ligada" : "Resposta automática desligada"); qc.invalidateQueries({ queryKey: ["support-settings"] }); },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar"),
  });
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold">Resposta automática</h2>
        <p className="text-xs text-muted-foreground mt-0.5">E-mail que chega com a tag <strong>Rastreio</strong> é respondido sozinho em até 5 minutos, a qualquer hora, com a situação real do pedido (etapa, último evento, link de rastreio). O que foi respondido e o que ficou pra equipe aparece na própria Caixa.</p>
      </div>
      <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
        <Bot className="size-4 text-primary mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Responder e-mails de rastreio automaticamente</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {aiAvailable
              ? "A IA escreve em inglês só com os dados do pedido e manda pelo Zoho, com a assinatura. Não responde sozinha — deixa pra equipe — quando o cliente já escreveu antes, fala em reembolso/cancelamento/disputa, ou o pedido foi cancelado/reembolsado. Só e-mails que chegarem depois de ligar."
              : "Falta configurar a chave da API da Anthropic (ANTHROPIC_API_KEY) no servidor."}
          </p>
        </div>
        <Switch checked={aiAvailable && on} disabled={!aiAvailable || toggle.isPending || q.isLoading} onCheckedChange={(v) => toggle.mutate(v)} />
      </div>
      <AutoReplyScript script={(q.data as any)?.autoReplyScript} />
      {aiAvailable && <AutoReplyExamples />}

    </div>
  );
}

// Roteiro que a IA segue na resposta automática (só leitura). Português pra
// ler; "Original" é o texto em inglês que a IA recebe de fato.
function AutoReplyScript({ script }: { script?: { pt: string; en: string } }) {
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState<"pt" | "en">("pt");
  if (!script) return null;
  return (
    <div className="rounded-xl border border-border">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between gap-2 px-4 py-3 text-sm font-medium hover:bg-muted/40 rounded-xl">
        Ver roteiro da IA
        <ChevronDown className={`size-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">As instruções que a IA segue pra decidir se responde e como escreve.</p>
            <div className="flex shrink-0 rounded-lg bg-muted p-0.5 text-[11px]">
              {(["pt", "en"] as const).map((l) => (
                <button key={l} type="button" onClick={() => setLang(l)}
                  className={`px-2 py-0.5 rounded-md ${lang === l ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}>
                  {l === "pt" ? "Português" : "Original (inglês)"}
                </button>
              ))}
            </div>
          </div>
          <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed font-sans bg-muted/30 rounded-lg p-3 max-h-[480px] overflow-y-auto">{script[lang]}</pre>
        </div>
      )}
    </div>
  );
}

// Exemplo: o que a IA faria com os últimos e-mails de rastreio (nada é enviado),
// ao lado do que a equipe mandou.
const KIND_LABEL: Record<string, { label: string; cls: string }> = {
  responder: { label: "Responderia sozinha", cls: "bg-success/10 text-success" },
  pulado: { label: "Deixaria pra equipe", cls: "bg-warning/10 text-warning" },
  fora: { label: "Fora da resposta automática", cls: "bg-muted text-muted-foreground" },
};
function AutoReplyExamples() {
  const fn = useSupportFn(previewSupportAutoReply, "previewSupportAutoReply");
  const run = useMutation({ mutationFn: () => fn(), onError: (e: any) => toast.error(e.message ?? "O teste falhou") });
  const items = run.data as Awaited<ReturnType<typeof previewSupportAutoReply>> | undefined;
  return (
    <div className="rounded-xl border border-border px-4 py-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Exemplo com e-mails reais</p>
          <p className="text-[11px] text-muted-foreground">Pega os 3 últimos e-mails de rastreio e mostra o que a IA faria — nada é enviado.</p>
        </div>
        <button type="button" onClick={() => run.mutate()} disabled={run.isPending}
          className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium flex items-center gap-1.5 shrink-0 disabled:opacity-50">
          {run.isPending ? <><Loader2 className="size-3.5 animate-spin" /> Testando…</> : <><Sparkles className="size-3.5" /> {items ? "Testar de novo" : "Ver exemplo"}</>}
        </button>
      </div>
      {items && !items.length && <p className="text-xs text-muted-foreground">Nenhum e-mail com a tag Rastreio nos últimos 14 dias.</p>}
      {items?.map((it, i) => {
        const k = KIND_LABEL[it.kind] ?? KIND_LABEL.fora;
        return (
          <div key={i} className="rounded-lg border border-border p-3 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-xs font-medium truncate">{it.subject || "(sem assunto)"} <span className="text-muted-foreground font-normal">· {it.from}</span></p>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${k.cls}`}>{k.label}</span>
            </div>
            <div className="grid gap-2 md:grid-cols-3 text-xs">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Cliente escreveu</p>
                <p className="whitespace-pre-wrap text-muted-foreground line-clamp-[12]">{it.cliente}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-primary mb-1">IA {it.kind === "responder" ? "responderia" : "não responderia"}</p>
                {it.kind === "responder" && it.resposta
                  ? <p className="whitespace-pre-wrap">{it.resposta.split(/(Track your order here)/g).map((p, j) => j % 2 ? <span key={j} className="text-primary font-semibold underline">{p}</span> : p)}</p>
                  : <p className="text-muted-foreground">Motivo: {it.motivo}</p>}
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Equipe mandou</p>
                <p className="whitespace-pre-wrap text-muted-foreground line-clamp-[12]">{it.equipe || "(ainda sem resposta)"}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Treino da IA (support-learning.server.ts): placar por tag e o manual aprendido.
function TrainingPanel() {
  const fn = useSupportFn(getSupportTraining, "getSupportTraining");
  const q = useQuery({ queryKey: ["support-training"], queryFn: () => fn(), refetchInterval: 120_000 });
  const d = q.data as Awaited<ReturnType<typeof getSupportTraining>> | undefined;
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Treino da IA</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Em todo e-mail que chega, a IA escreve a resposta que daria — aparece na Caixa como <strong>Sugestão da IA</strong> (nada é enviado).
          Quando a equipe responde, ela compara com o que vocês mandaram e aprende a diferença; uma vez por dia junta tudo no manual abaixo.
        </p>
      </div>
      {q.isLoading ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : (
        <>
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Tag</th>
                  <th className="text-right font-medium px-2 py-2">Comparados</th>
                  <th className="text-right font-medium px-2 py-2">Iguais</th>
                  <th className="text-right font-medium px-2 py-2">Parecidos</th>
                  <th className="text-right font-medium px-2 py-2">Diferentes</th>
                  <th className="text-left font-medium px-3 py-2 w-40">Acerto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {!d?.tags.length && (
                  <tr><td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">Nenhuma comparação ainda — aparece aqui assim que a equipe responder um e-mail que já tem sugestão da IA.</td></tr>
                )}
                {d?.tags.map((t) => (
                  <Fragment key={t.tag}>
                    <tr className="cursor-pointer hover:bg-muted/30" onClick={() => setOpen(open === t.tag ? null : t.tag)}>
                      <td className="px-3 py-2 font-medium">{t.tag}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{t.total}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-success">{t.igual}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{t.parecida}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-warning">{t.diferente}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div className={`h-full ${(t.acerto ?? 0) >= 80 ? "bg-success" : (t.acerto ?? 0) >= 50 ? "bg-primary" : "bg-warning"}`} style={{ width: `${t.acerto ?? 0}%` }} />
                          </div>
                          <span className="tabular-nums w-9 text-right">{t.acerto ?? "—"}%</span>
                        </div>
                      </td>
                    </tr>
                    {open === t.tag && (
                      <tr><td colSpan={6} className="px-3 py-2 bg-muted/20">
                        {!t.ultimas.length ? <p className="text-muted-foreground">Sem diferenças registradas.</p> : (
                          <ul className="space-y-1">
                            {t.ultimas.map((u, i) => <li key={i} className="text-muted-foreground"><span className="text-foreground">{fullTime(u.at)}:</span> {u.o_que_mudou}</li>)}
                          </ul>
                        )}
                      </td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground">Acerto = iguais + parecidos (mesma decisão da equipe). {d?.pendentes ? `${d.pendentes} sugestões esperando a resposta da equipe pra comparar.` : ""}</p>

          <div>
            <h3 className="text-sm font-semibold">O que a IA aprendeu</h3>
            <p className="text-[11px] text-muted-foreground mb-2">{d?.playbookAt ? `Manual atualizado em ${fullTime(d.playbookAt)} — tirado das respostas reais da equipe.` : "O manual sai na primeira rodada depois da atualização."}</p>
            {d?.playbook && (
              <div className="space-y-3 rounded-xl border border-border px-4 py-3 text-xs">
                {d.playbook.gerais.length > 0 && (
                  <div>
                    <p className="font-semibold mb-1">Geral</p>
                    <ul className="list-disc pl-4 space-y-0.5 text-muted-foreground">{d.playbook.gerais.map((r, i) => <li key={i}>{r}</li>)}</ul>
                  </div>
                )}
                {d.playbook.por_tag.map((t) => (
                  <div key={t.tag}>
                    <p className="font-semibold mb-1">{t.tag}</p>
                    <ul className="list-disc pl-4 space-y-0.5 text-muted-foreground">{t.regras.map((r, i) => <li key={i}>{r}</li>)}</ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function GoalsSettings() {
  const qc = useQueryClient();
  const getFn = useSupportFn(getSupportSettings, "getSupportSettings");
  const saveFn = useSupportFn(saveSupportSettings, "saveSupportSettings");
  const q = useQuery({ queryKey: ["support-settings"], queryFn: () => getFn() });
  const [first, setFirst] = useState<{ value: string; unit: Unit }>({ value: "30", unit: "min" });
  const [resolution, setResolution] = useState<{ value: string; unit: Unit }>({ value: "6", unit: "h" });
  useEffect(() => {
    if (!q.data?.goals) return;
    setFirst(toUnit(q.data.goals.firstResponseMin));
    setResolution(toUnit(q.data.goals.resolutionMin));
  }, [q.data]);

  const minutes = (g: { value: string; unit: Unit }) => Math.round(Number(g.value.replace(",", ".")) * (g.unit === "h" ? 60 : 1));
  const firstMin = minutes(first), resolutionMin = minutes(resolution);
  const valid = firstMin >= 1 && resolutionMin >= 1;
  const dirty = !!q.data?.goals && (firstMin !== q.data.goals.firstResponseMin || resolutionMin !== q.data.goals.resolutionMin);

  const save = useMutation({
    mutationFn: () => saveFn({ data: { goals: { firstResponseMin: firstMin, resolutionMin } } }),
    onSuccess: () => {
      toast.success("Metas salvas");
      qc.invalidateQueries({ queryKey: ["support-settings"] });
      qc.invalidateQueries({ queryKey: ["support-kpis"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar"),
  });

  if (q.isLoading) return <div className="grid place-items-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  const bhText = businessHoursLabel(q.data?.businessHours ?? DEFAULT_BUSINESS_HOURS);

  return (
    <div className="space-y-5">
      <BusinessHoursSettings current={q.data?.businessHours ?? DEFAULT_BUSINESS_HOURS} />
      <div className="border-t border-border" />
      <div>
        <h2 className="text-base font-semibold">Metas</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Usadas nos cards da aba KPI para mostrar se o atendimento está dentro ou fora da meta.</p>
      </div>
      <GoalRow label="Tempo médio de 1ª resposta" hint={`Do primeiro e-mail do cliente até a primeira resposta, contando só o horário comercial (${bhText}).`} goal={first} onChange={setFirst} />
      <GoalRow label="Tempo médio até solucionar" hint={`Do primeiro e-mail da conversa até a sua última resposta antes de resolver (o tempo esperando o cliente não conta), só no horário comercial (${bhText}).`} goal={resolution} onChange={setResolution} />
      <div className="flex justify-end">
        <button onClick={() => save.mutate()} disabled={!dirty || !valid || save.isPending}
          className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5 disabled:opacity-50">
          {save.isPending && <Loader2 className="size-4 animate-spin" />} Salvar metas
        </button>
      </div>
    </div>
  );
}

// Horário comercial: 1ª resposta, resolução e tempo médio de resposta só
// contam o tempo dentro dele.
const WEEKDAY_CHIPS = [
  { d: 1, label: "Seg" }, { d: 2, label: "Ter" }, { d: 3, label: "Qua" }, { d: 4, label: "Qui" },
  { d: 5, label: "Sex" }, { d: 6, label: "Sáb" }, { d: 0, label: "Dom" },
];
function BusinessHoursSettings({ current }: { current: BusinessHours }) {
  const qc = useQueryClient();
  const saveFn = useSupportFn(saveSupportSettings, "saveSupportSettings");
  const [h, setH] = useState<BusinessHours>(current);
  useEffect(() => { setH(current); }, [current.start, current.end, current.timeZone, current.days.join(",")]);
  const dirty = h.start !== current.start || h.end !== current.end || h.timeZone !== current.timeZone
    || [...h.days].sort().join(",") !== [...current.days].sort().join(",");
  const valid = h.end > h.start && h.days.length > 0;
  const save = useMutation({
    mutationFn: () => saveFn({ data: { businessHours: h } }),
    onSuccess: () => {
      toast.success("Horário comercial salvo");
      qc.invalidateQueries({ queryKey: ["support-settings"] });
      qc.invalidateQueries({ queryKey: ["support-kpis"] });
      qc.invalidateQueries({ queryKey: ["support-list"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar"),
  });
  const toggleDay = (d: number) => setH({ ...h, days: h.days.includes(d) ? h.days.filter((x) => x !== d) : [...h.days, d] });
  const select = "h-9 px-2 rounded-lg bg-background border border-border text-sm outline-none focus:border-primary cursor-pointer";

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-base font-semibold">Horário comercial</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Tempo médio de resposta, de 1ª resposta e de resolução só contam o tempo dentro deste horário
          (e-mail que chega fora dele começa a contar na abertura seguinte).
        </p>
      </div>
      <div className="rounded-xl border border-border px-4 py-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Das</span>
          <select value={h.start} onChange={(e) => setH({ ...h, start: Number(e.target.value) })} className={select}>
            {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, "0")}:00</option>)}
          </select>
          <span className="text-muted-foreground">às</span>
          <select value={h.end} onChange={(e) => setH({ ...h, end: Number(e.target.value) })} className={select}>
            {Array.from({ length: 24 }, (_, i) => i + 1).map((i) => <option key={i} value={i}>{i === 24 ? "24:00" : `${String(i).padStart(2, "0")}:00`}</option>)}
          </select>
          <span className="text-muted-foreground">fuso</span>
          <select value={h.timeZone} onChange={(e) => setH({ ...h, timeZone: e.target.value })} className={select}>
            {BUSINESS_TIMEZONES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAY_CHIPS.map(({ d, label }) => (
            <button key={d} type="button" onClick={() => toggleDay(d)}
              className={`h-8 px-3 rounded-lg text-xs font-medium border transition-colors ${h.days.includes(d) ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted"}`}>
              {label}
            </button>
          ))}
        </div>
        {!valid && <p className="text-xs text-destructive">{h.days.length ? "O fim precisa ser depois do início." : "Escolha pelo menos um dia."}</p>}
        {valid && <p className="text-[11px] text-muted-foreground">Fica: {businessHoursLabel(h)}</p>}
      </div>
      <div className="flex justify-end">
        <button onClick={() => save.mutate()} disabled={!dirty || !valid || save.isPending}
          className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5 disabled:opacity-50">
          {save.isPending && <Loader2 className="size-4 animate-spin" />} Salvar horário
        </button>
      </div>
    </div>
  );
}

function GoalRow({ label, hint, goal, onChange }: {
  label: string; hint: string; goal: { value: string; unit: Unit }; onChange: (g: { value: string; unit: Unit }) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-border px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <input value={goal.value} onChange={(e) => onChange({ ...goal, value: e.target.value.replace(/[^\d.,]/g, "") })} inputMode="decimal"
          className="w-16 h-9 px-2.5 rounded-lg bg-background border border-border text-sm text-right outline-none focus:border-primary" />
        <select value={goal.unit} onChange={(e) => onChange({ ...goal, unit: e.target.value as Unit })}
          className="h-9 px-2 rounded-lg bg-background border border-border text-sm outline-none focus:border-primary cursor-pointer">
          <option value="min">minutos</option>
          <option value="h">horas</option>
        </select>
      </div>
    </div>
  );
}
