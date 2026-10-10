import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle, Check, CheckCircle2, ChevronDown, ExternalLink, ImageOff, LayoutTemplate, Loader2, Plus, RefreshCw, Send, Settings2, X, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  getProductShopify, saveProductShopify, publishProductShopify, updateProductShopify, listVariantTemplates,
} from "@/lib/product-shopify.functions";
import { Link } from "@tanstack/react-router";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  UPDATE_PARTS, UPDATE_PART_LABELS, buildVariants, variantSku, type ShopifyListing, type StoreRole, type UpdatePart,
} from "@/lib/product-shopify";
import { SectionTitle } from "@/components/shops/StoreProduction";

const inputCls = "w-full h-9 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary/50";

export function ProductShopifyTab({ productId }: { productId: string }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const getFn = useServerFn(getProductShopify);
  const saveFn = useServerFn(saveProductShopify);
  const publishFn = useServerFn(publishProductShopify);
  const updateFn = useServerFn(updateProductShopify);
  const variantTplFn = useServerFn(listVariantTemplates);
  const { data: variantTemplates = [] } = useQuery({ queryKey: ["variant-templates"], queryFn: () => variantTplFn() });
  const queryKey = ["product-shopify", productId];
  const { data, isLoading, error } = useQuery({ queryKey, queryFn: () => getFn({ data: { product_id: productId } }) });

  const [listing, setListing] = useState<ShopifyListing | null>(null);
  const [selected, setSelected] = useState<Record<string, StoreRole>>({});
  const [parts, setParts] = useState<UpdatePart[]>([]);
  useEffect(() => { if (data && !listing) setListing(data.listing); }, [data, listing]);

  const save = useMutation({
    mutationFn: (l: ShopifyListing) => saveFn({ data: { product_id: productId, listing: l } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey }); toast.success("Ficha salva"); },
    onError: (e: any) => toast.error(e.message),
  });
  const publish = useMutation({
    mutationFn: (stores: { shopify_store_id: string; role: StoreRole }[]) =>
      publishFn({ data: { product_id: productId, listing: listing!, stores } }),
    onSuccess: ({ results }) => {
      qc.invalidateQueries({ queryKey });
      setSelected({});
      const ok = results.filter((r) => r.ok).length;
      const fail = results.length - ok;
      if (fail === 0) toast.success(`Produto criado em ${ok} ${ok === 1 ? "loja" : "lojas"}`);
      else toast.error(`${ok} criado(s), ${fail} com erro — veja na lista de lojas.`);
    },
    onError: (e: any) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: (stores: { shopify_store_id: string; role: StoreRole }[]) =>
      updateFn({ data: { product_id: productId, listing: listing!, stores, parts } }),
    onSuccess: ({ results }) => {
      qc.invalidateQueries({ queryKey });
      setSelected({});
      setParts([]);
      for (const r of results) {
        const name = data?.stores.find((s) => s.id === r.shopify_store_id)?.name ?? "Loja";
        (r.ok ? toast.success : toast.error)(`${name}: ${r.message}`);
      }
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading || !listing) return <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  if (error || !data) return <p className="text-sm text-destructive">{(error as any)?.message ?? "Não foi possível carregar."}</p>;

  const set = (patch: Partial<ShopifyListing>) => setListing((l) => {
    const next = { ...l!, ...patch };
    return patch.options ? { ...next, variants: buildVariants(next) } : next;
  });
  const hasVariants = listing.variants.length > 0;
  const pubByStore = new Map(data.publications.map((p) => [p.shopify_store_id, p]));
  const chosen = Object.entries(selected).map(([shopify_store_id, role]) => ({ shopify_store_id, role }));
  // Loja marcada onde o produto já existe = atualizar; onde não existe = criar.
  const isCreated = (id: string) => pubByStore.get(id)?.status === "ok";
  const toCreate = chosen.filter((c) => !isCreated(c.shopify_store_id));
  const toUpdate = chosen.filter((c) => isCreated(c.shopify_store_id));
  const storeNames = (list: typeof chosen) => list.map((c) => data.stores.find((s) => s.id === c.shopify_store_id)?.name).filter(Boolean).join(", ");

  const doUpdate = async () => {
    const ok = await confirm({
      title: "Atualizar o produto nas lojas?",
      description: `Vai atualizar ${parts.map((p) => UPDATE_PART_LABELS[p]).join(", ")} em: ${storeNames(toUpdate)}. O resto do produto fica como está.` +
        (parts.includes("variantes") ? " Variantes: valor renomeado continua a mesma variante; valor que não está mais na ficha tem a variante APAGADA na loja." : ""),
      confirmText: "Atualizar",
      variant: "default",
    });
    if (ok) update.mutate(toUpdate);
  };

  const doPublish = async () => {
    const names = toCreate.map((c) => data.stores.find((s) => s.id === c.shopify_store_id)?.name).filter(Boolean).join(", ");
    const ok = await confirm({
      title: "Criar o produto nas lojas?",
      description: `O produto será criado como Ativo e publicado na loja online em: ${names}.`,
      confirmText: "Criar produto",
      variant: "default",
    });
    if (ok) publish.mutate(toCreate);
  };

  return (
    <div className="space-y-6">
      <section>
        <SectionTitle>Nome</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Na matriz">
            <input value={listing.title_matriz} onChange={(e) => set({ title_matriz: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Nas sublojas">
            <input
              value={listing.title_subloja}
              onChange={(e) => set({ title_subloja: e.target.value })}
              placeholder={listing.title_matriz ? `Vazio = "${listing.title_matriz}"` : ""}
              className={inputCls}
            />
          </Field>
        </div>
      </section>

      <section>
        <SectionTitle>Descrição</SectionTitle>
        <textarea
          value={listing.description_html}
          onChange={(e) => set({ description_html: e.target.value })}
          rows={8}
          placeholder="Texto da página do produto. Aceita HTML (<p>, <strong>, <ul><li>, <img>...)."
          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary/50 resize-y font-mono"
        />
      </section>

      <section>
        <SectionTitle>Imagens</SectionTitle>
        {data.images.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma imagem — envie na aba Imagens.</p>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">Clique pra incluir ou tirar. A ordem dos números é a ordem na Shopify; a 1ª vira a imagem principal.</p>
            <div>
              <p className="text-xs font-medium mb-1.5">{listing.image_ids_subloja ? "Matriz" : "Matriz e sublojas"}</p>
              <ImagePicker images={data.images} value={listing.image_ids} onChange={(image_ids) => set({ image_ids })} />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none w-fit">
              <input
                type="checkbox"
                checked={!listing.image_ids_subloja}
                onChange={(e) => set({ image_ids_subloja: e.target.checked ? null : [...listing.image_ids] })}
                className="size-4 accent-primary"
              />
              Sublojas usam as mesmas imagens da matriz
            </label>
            {listing.image_ids_subloja && (
              <div>
                <p className="text-xs font-medium mb-1.5">Sublojas</p>
                <ImagePicker images={data.images} value={listing.image_ids_subloja} onChange={(image_ids_subloja) => set({ image_ids_subloja })} />
              </div>
            )}
          </div>
        )}
      </section>

      <section>
        <SectionTitle>Preço e estoque</SectionTitle>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label="Preço (US$)"><input value={listing.price} onChange={(e) => set({ price: e.target.value })} inputMode="decimal" className={inputCls} /></Field>
          <Field label='Preço "de" (US$)'><input value={listing.compare_at_price} onChange={(e) => set({ compare_at_price: e.target.value })} inputMode="decimal" className={inputCls} /></Field>
          <Field label="SKU"><input value={listing.sku} onChange={(e) => set({ sku: e.target.value })} placeholder="ex.: size" className={inputCls} /></Field>
          <Field label="Estoque">
            <input
              value={listing.inventory}
              onChange={(e) => {
                // Com variantes, vale pra todas (dá pra ajustar uma a uma na tabela).
                const inventory = Math.max(0, Math.round(Number(e.target.value) || 0));
                set({ inventory, variants: listing.variants.map((v) => ({ ...v, inventory })) });
              }}
              inputMode="numeric"
              className={inputCls}
            />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          O estoque vai pro local do endereço da loja; no local da Aprodrop o produto fica disponível (o estoque lá é do app). Sempre com
          "continuar vendendo sem estoque". O preço é o mesmo em todas as lojas.
        </p>
      </section>

      <section>
        <SectionTitle
          action={
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="h-8 px-3 rounded-lg border border-border text-xs font-medium flex items-center gap-1.5 hover:bg-muted">
                    <LayoutTemplate className="size-3.5" /> Aplicar template <ChevronDown className="size-3.5 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {variantTemplates.map((t) => (
                    <DropdownMenuItem key={t.id} onSelect={() => { set({ options: t.options.map((o) => ({ ...o, values: [...o.values] })) }); toast.success(`Variantes de "${t.name}" aplicadas`); }}>
                      <span className="flex-1 truncate">{t.name}</span>
                      {t.is_default && <span className="text-[10px] text-muted-foreground">padrão</span>}
                    </DropdownMenuItem>
                  ))}
                  {variantTemplates.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">Nenhum template de variantes.</p>}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link to="/settings/templates" search={{ tipo: "variantes" }}><Settings2 className="size-3.5" /> Gerenciar templates</Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {listing.options.length < 3 && (
                <button
                  onClick={() => set({ options: [...listing.options, { name: "", values: [] }] })}
                  className="h-8 px-3 rounded-lg border border-border text-xs font-medium flex items-center gap-1.5 hover:bg-muted"
                >
                  <Plus className="size-3.5" /> Opção
                </button>
              )}
            </div>
          }
        >
          Variantes
        </SectionTitle>
        {listing.options.length === 0 && <p className="text-sm text-muted-foreground">Sem variantes. Adicione uma opção (ex.: Cor, Tamanho) se o produto tiver.</p>}
        <div className="space-y-2">
          {listing.options.map((o, oi) => (
            <OptionRow
              key={oi}
              option={o}
              onChange={(next) => set({ options: listing.options.map((x, i) => (i === oi ? next : x)) })}
              onRemove={() => set({ options: listing.options.filter((_, i) => i !== oi) })}
              onRename={(from, to) => setListing((l) => ({
                ...l!,
                // Renomeia na opção e nas variantes, mantendo preço, SKU e estoque já preenchidos.
                options: l!.options.map((x, i) => (i === oi ? { ...x, values: x.values.map((v) => (v === from ? to : v)) } : x)),
                variants: l!.variants.map((vr) => (vr.values[oi] === from ? { ...vr, values: vr.values.map((v, i) => (i === oi ? to : v)) } : vr)),
              }))}
            />
          ))}
        </div>
        {hasVariants && (
          <div className="mt-3 rounded-xl border border-border overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead className="text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="text-left font-medium px-3 py-2">Variante</th>
                  <th className="text-left font-medium px-2 py-2 w-28">Preço</th>
                  <th className="text-left font-medium px-2 py-2 w-28">Preço "de"</th>
                  <th className="text-left font-medium px-2 py-2 w-36">SKU</th>
                  <th className="text-left font-medium px-2 py-2 w-24">Estoque</th>
                </tr>
              </thead>
              <tbody>
                {listing.variants.map((v, vi) => {
                  const setV = (patch: Partial<typeof v>) => set({ variants: listing.variants.map((x, i) => (i === vi ? { ...x, ...patch } : x)) });
                  const cell = "h-8 w-full px-2 rounded-md border border-border bg-background text-sm outline-none focus:border-primary/50";
                  return (
                    <tr key={v.values.join("/")} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-1.5 font-medium">{v.values.join(" / ")}</td>
                      <td className="px-2 py-1.5"><input value={v.price} onChange={(e) => setV({ price: e.target.value })} placeholder={listing.price} inputMode="decimal" className={cell} /></td>
                      <td className="px-2 py-1.5"><input value={v.compare_at_price} onChange={(e) => setV({ compare_at_price: e.target.value })} placeholder={listing.compare_at_price} inputMode="decimal" className={cell} /></td>
                      <td className="px-2 py-1.5"><input value={v.sku} onChange={(e) => setV({ sku: e.target.value })} placeholder={variantSku(listing.sku, v.values)} className={cell} /></td>
                      <td className="px-2 py-1.5"><input value={v.inventory} onChange={(e) => setV({ inventory: Math.max(0, Math.round(Number(e.target.value) || 0)) })} inputMode="numeric" className={cell} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-[11px] text-muted-foreground px-3 py-2 border-t border-border">
              Preço vazio = usa o preço do produto. SKU vazio = SKU do produto + "-" + valores da variante (o que aparece em cinza).
            </p>
          </div>
        )}
      </section>

      <section>
        <SectionTitle>SEO</SectionTitle>
        <div className="space-y-3">
          <Field label="Título da página (vazio = nome do produto)">
            <input value={listing.seo_title} onChange={(e) => set({ seo_title: e.target.value })} maxLength={70} className={inputCls} />
          </Field>
          <Field label="Descrição da página">
            <textarea
              value={listing.seo_description}
              onChange={(e) => set({ seo_description: e.target.value })}
              maxLength={320}
              rows={2}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary/50 resize-y"
            />
          </Field>
          <Field label="Endereço (handle) — vazio = gerado pelo nome">
            <input value={listing.handle} onChange={(e) => set({ handle: e.target.value })} placeholder="ex.: tapete-antiderrapante" className={inputCls} />
          </Field>
        </div>
      </section>

      <div className="flex justify-end">
        <button
          onClick={() => save.mutate(listing)}
          disabled={save.isPending}
          className="h-9 px-4 rounded-lg border border-border text-sm font-medium flex items-center gap-1.5 hover:bg-muted disabled:opacity-50"
        >
          {save.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Salvar ficha
        </button>
      </div>

      <section className="pt-4 border-t border-border">
        <SectionTitle>Lojas</SectionTitle>
        <p className="text-xs text-muted-foreground mb-2">
          Lojas da coluna Ativas do Banco de Lojas. Matriz ou Subloja define qual nome vai. Marque loja onde o produto ainda não existe
          pra criar, ou onde já foi criado pra atualizar partes dele.
        </p>
        {data.stores.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma loja na coluna Ativas do Banco de Lojas.</p>
        ) : (
          <div className="rounded-xl border border-border divide-y divide-border">
            {data.stores.map((s) => {
              const pub = pubByStore.get(s.id);
              const created = pub?.status === "ok";
              const blocked = s.missing_scopes.length > 0;
              const checked = s.id in selected;
              return (
                <div key={s.id} className="px-3 py-2.5 flex items-start gap-3">
                  <input
                    type="checkbox"
                    disabled={blocked}
                    checked={checked}
                    onChange={(e) => setSelected((prev) => {
                      const next = { ...prev };
                      if (e.target.checked) next[s.id] = (created && (pub.role === "matriz" || pub.role === "subloja") ? pub.role : s.role) as StoreRole;
                      else delete next[s.id];
                      return next;
                    })}
                    className="size-4 mt-0.5 accent-primary shrink-0 disabled:opacity-40"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{s.name}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{s.shop_domain}</p>
                    {created && (
                      <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1">
                        <CheckCircle2 className="size-3.5" /> Criado
                        {pub.shopify_product_id && (
                          <a href={`https://${s.shop_domain}/admin/products/${pub.shopify_product_id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline">
                            abrir na Shopify <ExternalLink className="size-3" />
                          </a>
                        )}
                      </p>
                    )}
                    {created && pub.warnings?.length > 0 && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-start gap-1"><AlertTriangle className="size-3.5 shrink-0 mt-px" /> {pub.warnings.join(" ")}</p>
                    )}
                    {pub?.status === "deleted" && (
                      <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1">
                        <XCircle className="size-3.5 shrink-0 mt-px" /> Apagado na Shopify — marque pra criar de novo.
                      </p>
                    )}
                    {pub?.status === "error" && (
                      <p className="text-xs text-destructive mt-1 flex items-start gap-1"><XCircle className="size-3.5 shrink-0 mt-px" /> {pub.error}</p>
                    )}
                    {blocked && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-start gap-1">
                        <AlertTriangle className="size-3.5 shrink-0 mt-px" /> Reconecte a loja com as permissões novas ({s.missing_scopes.join(", ")}).
                      </p>
                    )}
                  </div>
                  <select
                    value={selected[s.id] ?? ((pub?.role as StoreRole | null) ?? s.role)}
                    disabled={!checked}
                    onChange={(e) => setSelected((prev) => ({ ...prev, [s.id]: e.target.value as StoreRole }))}
                    className="h-8 px-2 rounded-lg border border-border bg-background text-xs outline-none shrink-0 disabled:opacity-50"
                    title="Define qual nome usar"
                  >
                    <option value="matriz">Matriz</option>
                    <option value="subloja">Subloja</option>
                  </select>
                </div>
              );
            })}
          </div>
        )}
        {toUpdate.length > 0 && (
          <div className="mt-3 rounded-xl border border-border bg-muted/20 p-3">
            <p className="text-xs font-medium mb-2">O que atualizar em {toUpdate.length === 1 ? "1 loja onde já foi criado" : `${toUpdate.length} lojas onde já foi criado`}:</p>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {UPDATE_PARTS.map((p) => (
                <label key={p} className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={parts.includes(p)}
                    onChange={(e) => setParts((prev) => (e.target.checked ? [...prev, p] : prev.filter((x) => x !== p)))}
                    className="size-4 accent-primary"
                  />
                  {UPDATE_PART_LABELS[p]}
                </label>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">Usa o que está na ficha acima. Imagens não são atualizadas por aqui. Em Variantes, valor removido da ficha apaga a variante na loja.</p>
          </div>
        )}
        <div className="flex justify-end gap-2 mt-3">
          {toUpdate.length > 0 && (
            <button
              onClick={doUpdate}
              disabled={parts.length === 0 || update.isPending}
              className="h-9 px-4 rounded-lg border border-border text-sm font-medium flex items-center gap-1.5 hover:bg-muted disabled:opacity-50"
            >
              {update.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              {update.isPending ? "Atualizando..." : `Atualizar em ${toUpdate.length} ${toUpdate.length === 1 ? "loja" : "lojas"}`}
            </button>
          )}
          {(toCreate.length > 0 || toUpdate.length === 0) && (
            <button
              onClick={doPublish}
              disabled={toCreate.length === 0 || publish.isPending}
              className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5 disabled:opacity-50"
            >
              {publish.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              {publish.isPending ? "Criando..." : toCreate.length > 0 ? `Criar em ${toCreate.length} ${toCreate.length === 1 ? "loja" : "lojas"}` : "Escolha as lojas"}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

export function ImagePicker({ images, value, onChange }: {
  images: { id: string; file_url: string | null; file_name: string | null }[]; value: string[]; onChange: (ids: string[]) => void;
}) {
  return (
    <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
      {images.map((img) => {
        const idx = value.indexOf(img.id);
        const on = idx !== -1;
        return (
          <button
            key={img.id}
            type="button"
            onClick={() => onChange(on ? value.filter((x) => x !== img.id) : [...value, img.id])}
            className={`relative aspect-square rounded-lg overflow-hidden border-2 ${on ? "border-primary" : "border-transparent opacity-50"}`}
          >
            {img.file_url ? <img src={img.file_url} alt={img.file_name ?? ""} className="w-full h-full object-cover" /> : <ImageOff className="size-5 m-auto text-muted-foreground" />}
            {on && <span className="absolute top-1 left-1 size-5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold grid place-items-center">{idx + 1}</span>}
          </button>
        );
      })}
    </div>
  );
}

// onRename: valor renomeado (clicar no valor edita) — quem usa pode levar junto
// o que já foi preenchido na variante.
export function OptionRow({ option, onChange, onRemove, onRename }: {
  option: { name: string; values: string[] }; onChange: (o: { name: string; values: string[] }) => void; onRemove: () => void;
  onRename?: (from: string, to: string) => void;
}) {
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const commitEdit = () => {
    const from = editing;
    setEditing(null);
    const to = draft.trim();
    if (!from || !to || to === from) return;
    if (option.values.includes(to)) { toast.error(`"${to}" já existe nesta opção`); return; }
    if (onRename) onRename(from, to);
    else onChange({ ...option, values: option.values.map((v) => (v === from ? to : v)) });
  };
  const add = () => {
    const vals = text.split(",").map((v) => v.trim()).filter((v) => v && !option.values.includes(v));
    if (vals.length) onChange({ ...option, values: [...option.values, ...vals] });
    setText("");
  };
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-2 rounded-xl border border-border p-2">
      <input
        value={option.name}
        onChange={(e) => onChange({ ...option, name: e.target.value })}
        placeholder="Opção (ex.: Cor)"
        className="sm:w-36 h-9 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary/50"
      />
      <div className="flex-1 flex flex-wrap items-center gap-1.5 min-h-9 px-2 py-1 rounded-lg border border-border bg-background">
        {option.values.map((v) => editing === v ? (
          <input
            key={v}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
              if (e.key === "Escape") setEditing(null);
            }}
            onBlur={commitEdit}
            style={{ width: `${Math.max(draft.length, 4) + 2}ch` }}
            className="h-7 px-2 rounded-md border border-primary/50 bg-background text-xs outline-none"
          />
        ) : (
          <span key={v} className="h-7 pl-2 pr-1 rounded-md bg-muted text-xs inline-flex items-center gap-1">
            <button type="button" onClick={() => { setEditing(v); setDraft(v); }} title="Clique pra editar" className="hover:underline">
              {v}
            </button>
            <button onClick={() => onChange({ ...option, values: option.values.filter((x) => x !== v) })} className="size-5 grid place-items-center text-muted-foreground hover:text-destructive">
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } }}
          onBlur={add}
          placeholder="Valores (Enter)"
          className="flex-1 min-w-24 h-7 bg-transparent text-sm outline-none"
        />
      </div>
      <button onClick={onRemove} title="Remover opção" className="size-9 rounded-lg grid place-items-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive shrink-0">
        <X className="size-4" />
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
