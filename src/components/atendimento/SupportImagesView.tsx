import { useEffect, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, ImageOff, Images, Loader2, MessageSquare, Paperclip, Search, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { listSupportImageProducts, listSupportImages, setSupportImageDownloaded, type SupportImage } from "@/lib/support-images.functions";
import { listSupportShops } from "@/lib/atendimento.functions";
import { formatDateTimeUS } from "@/lib/timezone";
import { displayableUrl } from "./EmailFrame";
import { useSupportFn } from "./demo";
import { displayName } from "./utils";

// Atendimento › Imagens: todas as fotos que os clientes mandaram (anexo ou no
// corpo do e-mail), mais novas primeiro, numa grade só. Clicar abre grande,
// com o cliente, o assunto e o atalho pra conversa. Baixar = já usou a foto:
// ela sai da grade e vai pra "Baixadas" (dá pra voltar). Filtro por produto
// (do pedido citado no assunto ou o último do cliente).

export function SupportImagesView({ onOpenConversation }: { onOpenConversation: (id: string) => void }) {
  const qc = useQueryClient();
  const listFn = useSupportFn(listSupportImages, "listSupportImages");
  const productsFn = useSupportFn(listSupportImageProducts, "listSupportImageProducts");
  const markFn = useSupportFn(setSupportImageDownloaded, "setSupportImageDownloaded");
  const shopsFn = useSupportFn(listSupportShops, "listSupportShops");
  const { data: shops = [] } = useQuery({ queryKey: ["support-shops"], queryFn: () => shopsFn(), staleTime: 10 * 60_000 });
  const shopName = new Map((shops as { id: string; name: string }[]).map((s) => [s.id, s.name]));

  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 350); return () => clearTimeout(t); }, [q]);
  const [shopId, setShopId] = useState<string | null>(null);
  const [product, setProduct] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [open, setOpen] = useState<SupportImage | null>(null);

  const list = useInfiniteQuery({
    queryKey: ["support-images", term, shopId, product, downloaded],
    queryFn: ({ pageParam }) => listFn({ data: { q: term, shopId, product, downloaded, before: pageParam } }),
    initialPageParam: null as string | null,
    getNextPageParam: (last: any) => last.nextBefore,
    staleTime: 60_000,
  });
  const items = (list.data?.pages ?? []).flatMap((p: any) => p.items as SupportImage[]);
  const pending = (list.data?.pages?.[0] as any)?.pending ?? 0;
  const products = useQuery({ queryKey: ["support-image-products"], queryFn: () => productsFn(), staleTime: 60_000 });
  const productList = ((products.data as any)?.products ?? []) as { name: string; count: number }[];
  const downloadedCount = ((products.data as any)?.downloaded ?? 0) as number;

  const mark = useMutation({
    mutationFn: (v: { id: string; downloaded: boolean }) => markFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["support-images"] });
      qc.invalidateQueries({ queryKey: ["support-image-products"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao atualizar a imagem"),
  });
  const download = async (it: SupportImage) => {
    if (!(await downloadImage(it)) || it.downloadedAt) return;
    mark.mutate({ id: it.id, downloaded: true });
    setOpen(null);
    toast.success("Foto baixada — foi pra Baixadas", {
      action: { label: "Desfazer", onClick: () => mark.mutate({ id: it.id, downloaded: false }) },
    });
  };

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
        <select value={product ?? ""} onChange={(e) => setProduct(e.target.value || null)}
          className="h-9 px-2 rounded-xl border border-border bg-background text-sm max-w-64">
          <option value="">Todos os produtos</option>
          {product && !productList.some((p) => p.name === product) && <option value={product}>{product}</option>}
          {productList.map((p) => <option key={p.name} value={p.name}>{p.name} ({p.count})</option>)}
        </select>
        <div className="flex gap-1 p-1 rounded-xl bg-muted">
          {([[false, "A usar"], [true, `Baixadas${downloadedCount ? ` (${downloadedCount})` : ""}`]] as const).map(([v, label]) => (
            <button key={String(v)} onClick={() => setDownloaded(v)}
              className={`h-7 px-3 rounded-lg text-xs font-medium ${downloaded === v ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              {label}
            </button>
          ))}
        </div>
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
            {downloaded && !term && !shopId && !product ? "Nenhuma foto baixada ainda" : term || shopId || product ? "Nenhuma imagem com esse filtro" : pending ? "As imagens dos e-mails estão sendo importadas — volte em alguns minutos" : "Nenhuma imagem de cliente ainda"}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {items.map((it) => (
              <button key={it.id} onClick={() => setOpen(it)} className="group text-left rounded-xl border border-border overflow-hidden bg-background hover:border-primary">
                <div className="aspect-square bg-muted overflow-hidden">
                  <Thumb image={it} size="thumb" className="size-full object-cover group-hover:scale-105 transition-transform" />
                </div>
                <div className="p-2 min-w-0">
                  <p className="text-xs font-medium truncate">{displayName(it.customerName, it.customerEmail ?? "")}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{it.products[0] ?? it.subject ?? "—"}</p>
                </div>
              </button>
            ))}
          </div>
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
                <Thumb image={open} size="large" className="max-h-[65vh] w-auto object-contain" />
              </div>
              <div className="text-xs text-muted-foreground space-y-0.5">
                {open.customerEmail && <p>{open.customerEmail}</p>}
                <p className="text-foreground">{open.subject ?? "—"}</p>
                {open.products.length > 0 && <p>Produto: {open.products.join(", ")}</p>}
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
                <button onClick={() => download(open)} disabled={!open.url}
                  className="h-9 px-4 rounded-lg border border-border text-sm flex items-center gap-2 hover:border-primary disabled:opacity-50">
                  <Download className="size-4" /> Baixar
                </button>
                {open.downloadedAt && (
                  <button onClick={() => { mark.mutate({ id: open.id, downloaded: false }); setOpen(null); }}
                    className="h-9 px-4 rounded-lg border border-border text-sm flex items-center gap-2 hover:border-primary">
                    <Undo2 className="size-4" /> Voltar pra A usar
                  </button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Mostra a miniatura salva. Se não tiver ou falhar, cai pro original — e foto
// do iPhone (HEIC), que não abre no Chrome, é convertida pra JPEG no navegador.
const HEIC = /hei[cf]/i;
function Thumb({ image, size, className }: { image: SupportImage; size: "thumb" | "large"; className?: string }) {
  const resized = size === "thumb" ? image.thumb : image.large;
  const [useOriginal, setUseOriginal] = useState(!resized);
  const heic = HEIC.test(image.mime ?? "") || HEIC.test(image.fileName ?? "");
  const [converted, setConverted] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const convert = useOriginal && heic && !!image.url;
  useEffect(() => {
    if (!convert) return;
    let alive = true, made: string | null = null;
    fetch(image.url!).then((res) => displayableUrl(res, image.fileName ?? "foto.heic"))
      .then((u) => { made = u; if (alive) setConverted(u); }).catch(() => alive && setFailed(true));
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [convert, image.url, image.fileName]);
  const src = !useOriginal ? resized : convert ? converted : image.url;
  if (failed || (useOriginal && !image.url)) return <div className="size-full grid place-items-center p-6"><ImageOff className="size-5 text-muted-foreground" /></div>;
  if (!src) return <div className="size-full grid place-items-center p-6"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>;
  return <img src={src} alt="" loading="lazy" decoding="async" className={className}
    onError={() => (useOriginal ? setFailed(true) : setUseOriginal(true))} />;
}

// Baixa sem metadados (aparelho, data, localização): redesenha a foto num
// canvas e salva de novo — o giro do celular já vai aplicado na imagem. HEIC
// é convertido antes (o Chrome não abre); sai JPEG, ou PNG se era PNG.
async function downloadImage(it: SupportImage): Promise<boolean> {
  if (!it.url) return false;
  try {
    let blob = await (await fetch(it.url)).blob();
    if (HEIC.test(it.mime ?? "") || HEIC.test(it.fileName ?? "")) {
      const { default: heic2any } = await import("heic2any");
      const out = await heic2any({ blob, toType: "image/jpeg", quality: 0.95 });
      blob = Array.isArray(out) ? out[0] : out;
    }
    const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width; canvas.height = bmp.height;
    canvas.getContext("2d")!.drawImage(bmp, 0, 0);
    bmp.close();
    const png = it.mime === "image/png";
    const clean = await new Promise<Blob>((ok, fail) =>
      canvas.toBlob((b) => (b ? ok(b) : fail(new Error("canvas"))), png ? "image/png" : "image/jpeg", 0.95));
    const base = (it.fileName || `imagem-${it.id.slice(0, 8)}`).replace(/\.[a-z0-9]+$/i, "");
    const url = URL.createObjectURL(clean);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${base}.${png ? "png" : "jpg"}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    toast.error("Não deu pra baixar a imagem");
    return false;
  }
}
