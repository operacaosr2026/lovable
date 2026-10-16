import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Clock, EyeOff, Languages, PackageCheck, Replace, Truck } from "lucide-react";
import {
  TRACKING_BRAND, HIDDEN_WORDS, CN_HIDDEN, CN_US_PHRASES, LOCAL_TRANSIT, EVENT_REWRITES,
} from "@/lib/tracking-display";

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

function RastreamentoPage() {
  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto pb-20 space-y-6">
      <header>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Rastreamento</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Como o rastreio dos pedidos funciona: o que o cliente vê na página de rastreio e as regras do
          acompanhamento pelo 17track. Os textos abaixo são os que o sistema usa de verdade.
        </p>
      </header>

      <Section icon={Replace} title="Textos trocados na página do cliente"
        desc="O texto que vem da transportadora é trocado antes de aparecer pro cliente.">
        <div className="space-y-2">
          {EVENT_REWRITES.map((r) => <Rewrite key={r.to} to={r.to} from={<span className="flex flex-wrap gap-1">{r.from.map((f) => <Chip key={f}>{f}</Chip>)}</span>} />)}
          <Rewrite from="Qualquer outro evento em chinês, alfândega, aeroporto, China ou fora dos EUA (um por dia)" to={LOCAL_TRANSIT} />
        </div>
      </Section>

      <Section icon={Languages} title="Chinês traduzido (China Post / EMS)"
        desc="Esses correios mandam tudo em chinês, até o que já acontece nos EUA. Só a movimentação dentro dos EUA é traduzida; o resto vira o “em trânsito” acima.">
        <div className="space-y-2">
          {CN_US_PHRASES.map(([re, to]) => (
            <Rewrite key={to} to={to} from={<span className="flex flex-wrap gap-1">{alternatives(re).map((p) => <Chip key={p}>{p}</Chip>)}</span>} />
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
          "Local só aparece se for nos EUA com estado (ex.: Phoenix, AZ), sem CEP. Fora dos EUA, o local some.",
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
