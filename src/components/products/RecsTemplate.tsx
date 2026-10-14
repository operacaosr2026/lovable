import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getRecsTemplate, saveRecsTemplate } from "@/lib/product-page.functions";
import type { PageRec } from "@/lib/product-page";
import { SectionTitle } from "@/components/shops/StoreProduction";
import { RecsEditor } from "@/components/products/page-fields";

const QK = ["recs-template"];

// Produtos recomendados padrão da aba Página: toda página nova (ou sem
// recomendados ainda) já começa com estes. Link vazio = o do card do produto.
export function RecsTemplate() {
  const qc = useQueryClient();
  const getFn = useServerFn(getRecsTemplate);
  const saveFn = useServerFn(saveRecsTemplate);
  const { data, isLoading } = useQuery({ queryKey: QK, queryFn: () => getFn() });
  const [draft, setDraft] = useState<{ recs_title: string; recs: PageRec[] } | null>(null);
  useEffect(() => { if (data && !draft) setDraft(data.template); }, [data, draft]);

  const save = useMutation({
    mutationFn: () => saveFn({ data: draft! }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: QK }); qc.invalidateQueries({ queryKey: ["product-page"] }); toast.success("Template salvo"); },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading || !draft || !data) return <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;

  return (
    <section className="premium-card p-6">
      <SectionTitle
        action={
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="h-9 px-4 rounded-xl bg-primary text-primary-foreground text-xs font-semibold inline-flex items-center gap-1.5 shadow-sm disabled:opacity-50"
          >
            {save.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Salvar template
          </button>
        }
      >
        Produtos recomendados
      </SectionTitle>
      <p className="text-xs text-muted-foreground mb-5">
        A seção "You might also like this" da aba Página. Toda página nova já vem com estes produtos, nesta ordem — o próprio produto
        sai da lista. Nas páginas que já existem, use "Usar template" na gaveta Produtos recomendados.
      </p>
      <RecsEditor
        title={draft.recs_title} recs={draft.recs} products={data.products}
        onChange={(patch) => setDraft((d) => ({ ...d!, ...patch }))}
        emptyText="Nenhum produto no template ainda."
      />
    </section>
  );
}
