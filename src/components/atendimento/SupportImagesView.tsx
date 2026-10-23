import { useEffect, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Download, ImageOff, Images, Loader2, MessageSquare, Paperclip, Search } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { listSupportImages, type SupportImage } from "@/lib/support-images.functions";
import { listSupportShops } from "@/lib/atendimento.functions";
import { formatDateUS, formatDateTimeUS } from "@/lib/timezone";
import { displayableUrl } from "./EmailFrame";
import { useSupportFn } from "./demo";
import { displayName } from "./utils";

// Atendimento › Imagens: todas as fotos que os clientes mandaram (anexo ou no
// corpo do e-mail), mais novas primeiro, agrupadas por dia. Clicar abre grande,
// com o cliente, o assunto e o atalho pra conversa.

export function SupportImagesView({ onOpenConversation }: { onOpenConversation: (id: string) => void }) {
  const listFn = useSupportFn(listSupportImages, "listSupportImages");
  const shopsFn = useSupportFn(listSupportShops, "listSupportShops");
  const { data: shops = [] } = useQuery({ queryKey: ["support-shops"], queryFn: () => shopsFn(), staleTime: 10 * 60_000 });
  const shopName = new Map((shops as { id: string; name: string }[]).map((s) => [s.id, s.name]));

  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 350); return () => clearTimeout(t); }, [q]);
  const [shopId, setShopId] = useState<string | null>(null);
  const [open, setOpen] = useState<SupportImage | null>(null);

  const list = useInfiniteQuery({
    queryKey: ["support-images", term, shopId],
    queryFn: ({ pageParam }) => listFn({ data: { q: term, shopId, before: pageParam } }),
    initialPageParam: null as string | null,
    getNextPageParam: (last: any) => last.nextBefore,
    staleTime: 60_000,
  });
  const items = (list.data?.pages ?? []).flatMap((p: any) => p.items as SupportImage[]);
  const pending = (list.data?.pages?.[0] as any)?.pending ?? 0;

  // Agrupa por dia (NY).
  const days: { day: string; items: SupportImage[] }[] = [];
  for (const it of items) {
    const day = formatDateUS(it.sentAt, { day: "2-digit", month: "2-digit", year: "numeric" });
    const last = days[days.length - 1];
    if (last?.day === day) last.items.push(it);
    else days.push({ day, items: [it] });
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-4 min-h-[60vh]">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[180px] max-w-80">
          <Search className="size-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por cliente, e-mail ou assunto…"
            className="w-full h-9 pl-8 pr-3 rounded-xl border border-border bg-background text-sm outline-none focus:border-primary" />
        </div>
        <select value={shopId ?? ""} onChange={(e) => setShopId(e.target.value || null)}
          className="h-9 px-2 rounded-xl border border-border bg-background text-sm">
          <option value="">Todas as lojas</option>
          {(shops as { id: string; name: string }[]).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {pending > 0 && (
          <span className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Loader2 className="size-3 animate-spin" /> Importando imagens de {pending} e-mail{pending === 1 ? "" : "s"}…
          </span>
        )}
      </div>

      {list.isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          {Array.from({ length: 12 }, (_, i) => <div key={i} className="aspect-square rounded-xl bg-muted animate-pulse" />)}
        </div>
      ) : list.error ? (
        <p className="text-sm text-destructive text-center py-16">{(list.error as Error).message}</p>
      ) : !items.length ? (
        <div className="text-center py-16">
          <Images className="size-8 mx-auto text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground mt-2">
            {term || shopId ? "Nenhuma imagem com esse filtro" : pending ? "As imagens dos e-mails estão sendo importadas — volte em alguns minutos" : "Nenhuma imagem de cliente ainda"}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {days.map((d) => (
            <section key={d.day}>
              <p className="text-xs font-semibold text-muted-foreground mb-2">{d.day} · {d.items.length} imagem{d.items.length === 1 ? "" : "s"}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                {d.items.map((it) => (
                  <button key={it.id} onClick={() => setOpen(it)} className="group text-left rounded-xl border border-border overflow-hidden bg-background hover:border-primary">
                    <div className="aspect-square bg-muted overflow-hidden">
                      <Thumb image={it} className="size-full object-cover group-hover:scale-105 transition-transform" />
                    </div>
                    <div className="p-2 min-w-0">
                      <p className="text-xs font-medium truncate">{displayName(it.customerName, it.customerEmail ?? "")}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{it.subject ?? "—"}</p>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))}
          {list.hasNextPage && (
            <button onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}
              className="mx-auto h-9 px-4 rounded-xl border border-border text-sm flex items-center gap-2 hover:border-primary disabled:opacity-50">
              {list.isFetchingNextPage && <Loader2 className="size-3.5 animate-spin" />} Carregar mais
            </button>
          )}
        </div>
      )}

      <Dialog open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="max-w-3xl">
          {open && (
            <div className="space-y-3">
              <DialogTitle className="text-base">{displayName(open.customerName, open.customerEmail ?? "")}</DialogTitle>
              <div className="rounded-xl bg-muted grid place-items-center max-h-[65vh] overflow-hidden">
                <Thumb image={open} className="max-h-[65vh] w-auto object-contain" />
              </div>
              <div className="text-xs text-muted-foreground space-y-0.5">
                {open.customerEmail && <p>{open.customerEmail}</p>}
                <p className="text-foreground">{open.subject ?? "—"}</p>
                <p className="flex items-center gap-1">
                  {open.source === "anexo" ? <Paperclip className="size-3" /> : <Images className="size-3" />}
                  {open.source === "anexo" ? "Anexo" : "No corpo do e-mail"} · {formatDateTimeUS(open.sentAt, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })} (NY)
                  {open.shopId && shopName.get(open.shopId) ? ` · ${shopName.get(open.shopId)}` : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { onOpenConversation(open.conversationId); setOpen(null); }}
                  className="flex-1 h-9 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center gap-2">
                  <MessageSquare className="size-4" /> Abrir conversa
                </button>
                <button onClick={() => downloadImage(open)} disabled={!open.url}
                  className="h-9 px-4 rounded-lg border border-border text-sm flex items-center gap-2 hover:border-primary disabled:opacity-50">
                  <Download className="size-4" /> Baixar
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Foto do iPhone (HEIC) não abre no Chrome: converte pra JPEG no navegador.
const HEIC = /hei[cf]/i;
function Thumb({ image, className }: { image: SupportImage; className?: string }) {
  const heic = HEIC.test(image.mime ?? "") || HEIC.test(image.fileName ?? "");
  const [src, setSrc] = useState<string | null>(heic ? null : image.url);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!heic || !image.url) return;
    let alive = true, made: string | null = null;
    fetch(image.url).then((res) => displayableUrl(res, image.fileName ?? "foto.heic"))
      .then((u) => { made = u; if (alive) setSrc(u); }).catch(() => alive && setFailed(true));
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [heic, image.url, image.fileName]);
  if (failed || !image.url) return <div className="size-full grid place-items-center p-6"><ImageOff className="size-5 text-muted-foreground" /></div>;
  if (!src) return <div className="size-full grid place-items-center p-6"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>;
  return <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className={className} />;
}

async function downloadImage(it: SupportImage) {
  if (!it.url) return;
  const blob = await (await fetch(it.url)).blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = it.fileName || `imagem-${it.id.slice(0, 8)}.${(it.mime ?? "image/png").split("/")[1]}`;
  a.click();
  URL.revokeObjectURL(url);
}
