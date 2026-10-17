import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowRight, Check, Clock, EyeOff, Languages, Loader2, PackageCheck, Replace, Search, Truck, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  TRACKING_BRAND, HIDDEN_WORDS, CN_HIDDEN, CN_US_PHRASES, CN_NEUTRAL, LOCAL_TRANSIT, EVENT_REWRITES, cleanEventText,
} from "@/lib/tracking-display";
import { listTrackingTexts, saveTrackingTextOverride, type TrackingTextRow } from "@/lib/tracking-texts.functions";

export const Route = createFileRoute("/settings/rastreamento")({
  component: RastreamentoPage,
});

// Trechos de uma regex de alternativas ("a|b|c") pra mostrar como etiquetas.
const alternatives = (re: RegExp) => re.source.split("|").map((p) => p.replace(/\\b/g, "").replace(/[()]/g, "").replace(/\.\*/g, "…").replace(/\\/g, ""));

function Section({ icon: Icon, title, desc, children }: { icon: typeof Truck; title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="premium-card p-6 space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">{title}</h2>
        </div>
        {desc && <p className="text-xs text-muted-foreground mt-1">{desc}</p>}
      </div>
      {children}
    </section>
  );
}

function Rewrite({ from, to }: { from: React.ReactNode; to: string }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3 rounded-lg border border-border px-3 py-2 text-sm">
      <span className="text-muted-foreground min-w-0 break-words">{from}</span>
      <ArrowRight className="size-3.5 text-muted-foreground shrink-0 hidden sm:block" />
      <span className="font-medium">{to}</span>
    </div>
  );
}

const Chip = ({ children }: { children: React.ReactNode }) => (
  <span className="inline-block rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{children}</span>
);

const Rules = ({ items }: { items: React.ReactNode[] }) => (
  <ul className="space-y-2 text-sm list-disc pl-5 marker:text-muted-foreground/50">
    {items.map((it, i) => <li key={i}>{it}</li>)}
  </ul>
);

const TABS = [
  { id: "regras", label: "Regras" },
  { id: "textos", label: "Textos" },
] as const;
type Tab = (typeof TABS)[number]["id"];

function RastreamentoPage() {
  const [tab, setTab] = useState<Tab>("regras");
  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto pb-20 space-y-6">
      <header>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Rastreamento</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Como o rastreio dos pedidos funciona: o que o cliente vê na página de rastreio e as regras do
          acompanhamento pelo 17track. Os textos abaixo são os que o sistema usa de verdade.
        </p>
      </header>

      <div className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm -mb-px border-b-2 transition-colors ${
              tab === t.id ? "border-primary text-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "regras" ? <RegrasTab /> : <TextosTab />}
    </div>
  );
}

type Filtro = "todos" | "escondidos" | "como_vem" | "trocados";
const FILTROS: { id: Filtro; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "escondidos", label: `Viram “${LOCAL_TRANSIT}”` },
  { id: "como_vem", label: "Aparecem como vêm" },
  { id: "trocados", label: "Trocados por você" },
];

function TextosTab() {
  const listFn = useServerFn(listTrackingTexts);
  const q = useQuery({ queryKey: ["tracking-texts"], queryFn: () => listFn(), staleTime: 60_000 });
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const rows = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return (q.data ?? []).filter((r) => {
      if (b && !`${r.example} ${r.rule ?? ""} ${r.override ?? ""}`.toLowerCase().includes(b)) return false;
      if (filtro === "escondidos") return r.generic && !r.override;
      if (filtro === "como_vem") return !r.generic && !r.override && r.rule != null && r.rule.toLowerCase() === cleanEventText(r.example).toLowerCase();
      if (filtro === "trocados") return !!r.override;
      return true;
    });
  }, [q.data, busca, filtro]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Cada texto que a transportadora mandou nos rastreios dos últimos 60 dias e o que o cliente vê hoje na
        página de rastreio. Pra trocar, escreva o texto novo e salve — vale na hora pra todos os pedidos com esse
        texto (números como datas e horários não importam). O local continua o que vem.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="size-4 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar texto" className="pl-8" />
        </div>
        <div className="flex flex-wrap gap-1">
          {FILTROS.map((f) => (
            <button key={f.id} type="button" onClick={() => setFiltro(f.id)}
              className={`px-2.5 py-1.5 rounded-md text-xs border transition-colors ${
                filtro === f.id ? "bg-primary/10 border-primary/30 text-foreground" : "border-border text-muted-foreground hover:text-foreground"
              }`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {q.isLoading ? (
        <div className="premium-card p-10 grid place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
      ) : q.error ? (
        <div className="premium-card p-6 text-sm text-destructive">{(q.error as Error).message}</div>
      ) : (
        <div className="premium-card divide-y divide-border">
          <div className="hidden md:grid grid-cols-[1fr_1fr_1.1fr] gap-4 px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            <span>Texto que vem</span><span>Cliente vê hoje</span><span>Trocar por</span>
          </div>
          {rows.length === 0 && <p className="p-6 text-sm text-muted-foreground text-center">Nenhum texto.</p>}
          {rows.slice(0, 300).map((r) => <TextoRow key={r.key} row={r} />)}
          {rows.length > 300 && <p className="p-3 text-xs text-muted-foreground text-center">Mostrando 300 de {rows.length} — use a busca.</p>}
        </div>
      )}
    </div>
  );
}

function TextoRow({ row }: { row: TrackingTextRow }) {
  const qc = useQueryClient();
  const saveFn = useServerFn(saveTrackingTextOverride);
  const [text, setText] = useState(row.override ?? "");
  useEffect(() => setText(row.override ?? ""), [row.override]);
  const save = useMutation({
    mutationFn: (t: string) => saveFn({ data: { example: row.example, text: t } }),
    onSuccess: (_, t) => { qc.invalidateQueries({ queryKey: ["tracking-texts"] }); toast.success(t ? "Texto trocado" : "Voltou pra regra"); },
    onError: (e: any) => toast.error(e.message ?? "Falha ao salvar"),
  });
  const dirty = text.trim() !== (row.override ?? "");

  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1.1fr] gap-2 md:gap-4 px-4 py-3 text-sm">
      <div className="min-w-0">
        <p className="break-words">{row.example}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {row.count} {row.count === 1 ? "evento" : "eventos"}{row.location ? ` · ${row.location}` : ""}
        </p>
      </div>
      <div className="min-w-0">
        {row.override ? (
          <>
            <p className="font-medium break-words">{row.override}</p>
            <p className="text-[11px] text-primary mt-0.5">trocado por você · regra: {row.rule ?? "some"}</p>
          </>
        ) : row.rule == null ? (
          <p className="text-muted-foreground italic">não aparece</p>
        ) : (
          <>
            <p className="break-words">{row.rule}</p>
            {row.generic && <p className="text-[11px] text-warning mt-0.5">escondido (alfândega, China, voo…)</p>}
          </>
        )}
      </div>
      <form className="flex gap-1.5 items-start" onSubmit={(e) => { e.preventDefault(); if (dirty) save.mutate(text.trim()); }}>
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Texto novo" maxLength={300} className="h-8 text-sm" />
        <Button type="submit" size="sm" className="h-8" disabled={!dirty || save.isPending}>
          {save.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
        </Button>
        {row.override && (
          <Button type="button" size="sm" variant="ghost" className="h-8" title="Voltar pra regra" disabled={save.isPending} onClick={() => save.mutate("")}>
            <Undo2 className="size-3.5" />
          </Button>
        )}
      </form>
    </div>
  );
}

function RegrasTab() {
  return (
    <div className="space-y-6">

      <Section icon={Replace} title="Textos trocados na página do cliente"
        desc="O texto que vem da transportadora é trocado antes de aparecer pro cliente.">
        <div className="space-y-2">
          {EVENT_REWRITES.map((r) => <Rewrite key={r.to} to={r.to} from={<span className="flex flex-wrap gap-1">{r.from.map((f) => <Chip key={f}>{f}</Chip>)}</span>} />)}
          <Rewrite from="Qualquer outro evento em chinês, alfândega, aeroporto, China ou fora dos EUA (um por dia)" to={LOCAL_TRANSIT} />
        </div>
      </Section>

      <Section icon={Languages} title="Chinês traduzido (China Post / EMS)"
        desc="Esses correios mandam tudo em chinês, até o que já acontece nos EUA. Cada etapa vira um nome neutro (os mesmos dos textos em inglês); o que não está na lista vira o “em trânsito” acima.">
        <div className="space-y-2">
          {[...CN_US_PHRASES, ...CN_NEUTRAL].map(([re, to]) => (
            <Rewrite key={re.source} to={to} from={<span className="flex flex-wrap gap-1">{alternatives(re).map((p) => <Chip key={p}>{p}</Chip>)}</span>} />
          ))}
        </div>
        <div className="text-xs text-muted-foreground space-y-1.5">
          <p>Em chinês, sempre escondido (vira “{LOCAL_TRANSIT}”):</p>
          <div className="flex flex-wrap gap-1">{alternatives(CN_HIDDEN).map((p) => <Chip key={p}>{p}</Chip>)}</div>
        </div>
      </Section>

      <Section icon={EyeOff} title="O que nunca aparece pro cliente"
        desc={`A marca é sempre ${TRACKING_BRAND.name} (uma página pra todas as lojas) e nada pode indicar que o pacote vem da China.`}>
        <Rules items={[
          <>Evento com alguma dessas palavras vira “{LOCAL_TRANSIT}”, sem local — no máximo um por dia:
            <div className="flex flex-wrap gap-1 mt-1.5">{HIDDEN_WORDS.map((w) => <Chip key={w}>{w.replace(/\\b/g, "").replace(/ \?/g, " ")}</Chip>)}</div></>,
          "Qualquer texto com caractere fora do padrão (chinês ou corrompido) também vira “em trânsito”.",
          "Local dos EUA aparece como vem, sem CEP: cidade e estado (Phoenix, AZ); só o estado vira o nome por extenso (US, CA 90640 → California); só a cidade (Atlanta) aparece depois que o pacote chega nos EUA. Local da China nunca aparece.",
          "Tira o local do começo do texto (“MA, US, Parcel has been delivered” → “Parcel has been delivered”) e a cópia “(中文:…)” do fim.",
          "Evento repetido (mesmo texto no mesmo lugar) aparece uma vez só.",
          "“Em trânsito” de antes da etiqueta criada sai (é o aviso de pré-postagem em chinês).",
        ]} />
      </Section>

      <Section icon={PackageCheck} title="Etapas e entrega"
        desc="Ordered · Order Ready · In Transit · Out for Delivery · Delivered">
        <Rules items={[
          "A etapa Delivered só acende com entrega confirmada (status geral do rastreio ou data de entrega no pedido) — nunca só porque um texto começa com “Delivered”.",
          "“Delivered to local carrier” é repasse entre transportadoras: não conta como entregue e o pedido não sai da fila.",
          "Evento que começa com “Delivered” e é entrega ao cliente (“Delivered, Front Door”, “Delivered, In/At Mailbox”…) conta como entregue, mesmo com o status geral ainda em “Out for delivery”.",
          "Pedido com mais de um pacote (itens em envios separados): só conta como entregue quando todos os pacotes forem entregues.",
          "Previsão de entrega: só a oficial da transportadora (não a estimada pelo 17track).",
        ]} />
      </Section>

      <Section icon={Clock} title="Acompanhamento (17track)"
        desc="O sync roda 2x por hora (:07 e :37).">
        <Rules items={[
          "Pedido em aberto (sem entregue ou cancelado) é acompanhado até 180 dias.",
          "Só pedido com até 60 dias gasta crédito ao cadastrar o código (1 crédito por código, uma vez só).",
          "Envio cancelado ou código trocado na Shopify: passa a seguir o envio ativo mais recente (o primeiro pacote foi descartado).",
          "Evento mais antigo que o já gravado (chegou fora de ordem) não volta o status.",
          "Postagem (TM Postagem) = 1ª movimentação real do pacote, pulando “informação eletrônica recebida / etiqueta criada”. Conta só dias úteis (aba Feriados).",
          "Na Shopify: manda o status pro envio quando muda e troca o link de rastreio pro link da loja — sem avisar o cliente.",
          "Problema no rastreio vira um motivo em português na Obs da aba Rastreamento (só se estiver vazia): erro no desembaraço, apreendido na alfândega, endereço incorreto, cliente recusou, devolvido ao remetente, tentativa de entrega falhou, sem atualização há muito tempo.",
        ]} />
      </Section>
    </div>
  );
}
