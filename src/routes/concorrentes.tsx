import { createFileRoute } from "@tanstack/react-router";
import { BellRing, Brain, Clock, Eye, LineChart, Megaphone, Radar, Swords } from "lucide-react";
import { PageShell } from "@/components/PageHeader";
import { requireAuth } from "@/lib/route-guards";

export const Route = createFileRoute("/concorrentes")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Concorrentes — SRX Growth" }] }),
  component: ConcorrentesPage,
});

// Página em construção: central dos concorrentes de alto nível (vindos do
// quadro Concorrentes do produto) — anúncios, análises e alertas.
const PILLARS = [
  {
    icon: Megaphone, title: "Anúncios ativos",
    text: "Puxa os anúncios de cada concorrente pela Biblioteca de Anúncios da Meta: criativos, copy, países e quando começaram a rodar.",
  },
  {
    icon: Clock, title: "Tempo no ar",
    text: "Anúncio rodando há mais de 30 dias tende a ser vencedor. Ranking dos criativos que estão segurando a escala.",
  },
  {
    icon: Eye, title: "Monitoramento diário",
    text: "Foto diária de cada concorrente: anúncios novos, pausados, quantidade ativa e mudanças de preço e de página.",
  },
  {
    icon: BellRing, title: "Alertas",
    text: "Aviso no sino quando um concorrente escala (muitos criativos novos), corta anúncios, muda o preço ou troca a oferta.",
  },
  {
    icon: Brain, title: "Análise com IA",
    text: "Dossiê por concorrente: ângulos de venda, hooks, formatos e ofertas, comparados com os seus, com recomendações.",
  },
  {
    icon: LineChart, title: "Visão de mercado",
    text: "Linha do tempo de atividade dos concorrentes, ranking de ameaça e sinais de saturação por produto.",
  },
];

function ConcorrentesPage() {
  return (
    <PageShell>
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Concorrentes</h1>
        <p className="text-sm text-muted-foreground mt-1">Inteligência sobre os concorrentes de alto nível</p>
      </div>

      <section className="premium-card p-6 sm:p-8 mb-6">
        <div className="flex items-start gap-4">
          <div className="size-12 rounded-2xl bg-primary/10 text-primary grid place-items-center shrink-0"><Radar className="size-6" /></div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight">Em construção</h2>
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600">Próximo projeto</span>
            </div>
            <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">
              Aqui vão ficar os concorrentes que você marcar como <strong className="text-foreground font-medium">alto nível</strong> no
              quadro Concorrentes de cada produto (Produtos › Inteligência › Concorrentes). Para eles, a página vai acompanhar os anúncios,
              analisar o que estão fazendo e avisar quando algo mudar.
            </p>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {PILLARS.map(({ icon: Icon, title, text }) => (
          <div key={title} className="premium-card p-5">
            <div className="size-9 rounded-xl bg-muted text-foreground grid place-items-center mb-3"><Icon className="size-4.5" /></div>
            <h3 className="text-sm font-semibold">{title}</h3>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{text}</p>
          </div>
        ))}
      </div>

      <section className="premium-card p-6">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><Swords className="size-4 text-primary" /> Como vai funcionar</h3>
        <ol className="space-y-2 text-sm text-muted-foreground list-decimal pl-5">
          <li>No quadro de um concorrente do produto, clique em <strong className="text-foreground font-medium">Alto nível</strong>.</li>
          <li>Ele aparece aqui, com a página de anúncios da Meta vinculada.</li>
          <li>Todo dia os anúncios são coletados e comparados com o dia anterior.</li>
          <li>Mudanças relevantes viram alertas e alimentam a análise com IA.</li>
        </ol>
      </section>
    </PageShell>
  );
}
