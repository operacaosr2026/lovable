import { useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageShell, PageHeader } from "@/components/PageHeader";
import {
  Plus, Store, MapPin, Layers, Upload, X, Check,
} from "lucide-react";
import {
  listLgCards, createLgCard, updateLgCard, deleteLgCard,
  listAllShopsForPicker, LG_STATUSES, getLgCardQuickMetrics,
} from "@/lib/lg-cards.functions";
import { supabase } from "@/integrations/supabase/client";
import { useEscapeToClose } from "@/hooks/use-escape-to-close";
import { useConfirm } from "@/components/ui/confirm-dialog";

export const Route = createFileRoute("/shops/lojas-grupos/")({
  component: LojasGruposIndex,
});

const STATUS_META: Record<string, { label: string; tint: string; accent: string }> = {
  ativo:     { label: "Ativo",     tint: "oklch(0.96 0.04 155)",  accent: "oklch(0.5 0.13 155)" },
  pausado:   { label: "Pausado",   tint: "oklch(0.96 0.03 75)",   accent: "oklch(0.55 0.16 65)" },
  arquivado: { label: "Arquivado", tint: "oklch(0.95 0.005 250)", accent: "oklch(0.45 0.015 260)" },
};

const COUNTRIES = [
  { code: "US", label: "Estados Unidos", flag: "🇺🇸" },
  { code: "CA", label: "Canadá",         flag: "🇨🇦" },
  { code: "GB", label: "Reino Unido",    flag: "🇬🇧" },
  { code: "BE", label: "Bélgica",        flag: "🇧🇪" },
  { code: "CH", label: "Suíça",          flag: "🇨🇭" },
  { code: "AU", label: "Austrália",      flag: "🇦🇺" },
];

function LojasGruposIndex() {
  const qc = useQueryClient();
  const listFn   = useServerFn(listLgCards);
  const createFn = useServerFn(createLgCard);
  const updateFn = useServerFn(updateLgCard);
  const deleteFn = useServerFn(deleteLgCard);
  const confirm  = useConfirm();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing]       = useState<any>(null);
  const [saveError, setSaveError]   = useState<string | null>(null);

  const { data } = useQuery({ queryKey: ["lg-cards"], queryFn: () => listFn() });
  const cards = (data?.cards ?? []) as any[];

  const refresh = () => qc.invalidateQueries({ queryKey: ["lg-cards"] });

  const create = useMutation({
    mutationFn: (input: any) => createFn({ data: input }),
    onSuccess:  refresh,
  });
  const update = useMutation({
    mutationFn: (input: any) => updateFn({ data: input }),
    onSuccess:  refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess:  refresh,
  });

  return (
    <PageShell>
      <PageHeader
        title="Lojas e Grupos"
        subtitle={`${cards.length} ${cards.length === 1 ? "card" : "cards"}`}
        actions={
          <button
            onClick={() => { setEditing(null); setEditorOpen(true); }}
            className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5"
          >
            <Plus className="size-4" /> Novo card
          </button>
        }
      />

      {cards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <Layers className="size-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nenhum card criado ainda.</p>
          <button
            onClick={() => { setEditing(null); setEditorOpen(true); }}
            className="mt-4 h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-1.5"
          >
            <Plus className="size-4" /> Criar primeiro card
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {cards.map((card: any) => (
            <LgCardItem
              key={card.id}
              card={card}
              onEdit={() => { setEditing(card); setEditorOpen(true); }}
              onDelete={() =>
                confirm(`Excluir "${card.name}"?`).then((ok) => {
                  if (ok) remove.mutate(card.id);
                })
              }
            />
          ))}
        </div>
      )}

      {editorOpen && (
        <LgCardEditor
          card={editing}
          saveError={saveError}
          onClose={() => { setEditorOpen(false); setSaveError(null); }}
          onSave={async (payload) => {
            setSaveError(null);
            try {
              if (editing) {
                await update.mutateAsync({ id: editing.id, patch: payload.card, shops: payload.shops });
              } else {
                await create.mutateAsync(payload);
              }
              setEditorOpen(false);
            } catch (err: any) {
              setSaveError(err?.message ?? "Erro ao salvar");
            }
          }}
          onDelete={editing ? async () => {
            if (await confirm(`Excluir "${editing.name}"?`)) {
              await remove.mutateAsync(editing.id);
              setEditorOpen(false);
            }
          } : undefined}
        />
      )}
    </PageShell>
  );
}

// ─── Card item ───────────────────────────────────────────────────────────────

function fmt(value: number, currency?: string) {
  return new Intl.NumberFormat("pt-BR", {
    style: currency ? "currency" : "decimal",
    currency: currency ?? undefined,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function LgCardItem({ card, onEdit, onDelete }: { card: any; onEdit: () => void; onDelete: () => void }) {
  const st = STATUS_META[card.status] ?? STATUS_META.ativo;
  const shops: any[] = card.card_shops ?? [];
  const country = COUNTRIES.find((c) => c.code === card.country);

  const metricsFn = useServerFn(getLgCardQuickMetrics);
  const { data: metrics, isLoading: loadingMetrics } = useQuery({
    queryKey: ["lg-card-metrics", card.id],
    queryFn:  () => metricsFn({ data: { card_id: card.id } }),
    enabled:  shops.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="group relative rounded-2xl border border-border bg-surface hover:border-primary/40 transition-colors overflow-hidden">
      <Link
        to="/shops/lojas-grupos/$cardId"
        params={{ cardId: card.id }}
        search={{ tab: "overview" as const }}
        className="block p-5"
      >
        {/* Header */}
        <div className="flex items-start gap-3 mb-3">
          <div className="size-12 rounded-xl grid place-items-center shrink-0 bg-primary/10 text-primary text-base font-semibold">
            {card.logo_url
              ? <img src={card.logo_url} alt="logo" className="size-12 rounded-xl object-cover" />
              : card.name?.[0]?.toUpperCase() ?? <Layers className="size-6" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-base font-semibold leading-tight truncate flex items-center gap-1.5">
              <span className="truncate">{card.name}</span>
              {card.tag && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20 truncate max-w-[100px]">
                  {card.tag}
                </span>
              )}
            </div>
            {country ? (
              <div className="text-[11px] text-muted-foreground mt-0.5 inline-flex items-center gap-1">
                <span className="text-sm leading-none">{country.flag}</span> {country.label}
              </div>
            ) : card.country ? (
              <div className="text-[11px] text-muted-foreground mt-0.5 inline-flex items-center gap-1">
                <MapPin className="size-3" /> {card.country}
              </div>
            ) : null}
          </div>
          <span
            className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md font-medium shrink-0"
            style={{ background: st.tint, color: st.accent }}
          >
            {st.label}
          </span>
        </div>

        {card.description && (
          <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{card.description}</p>
        )}

        {/* Shops list */}
        {shops.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
            Nenhuma loja conectada
          </div>
        ) : (
          <div className="rounded-lg bg-muted/40 border border-border px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
              {shops.length === 1 ? "Loja" : `Lojas (${shops.length})`}
            </div>
            <div className="space-y-1">
              {shops.slice(0, 3).map((s: any) => (
                <div key={s.id} className="text-xs truncate flex items-center gap-1.5">
                  <Store className="size-3 text-muted-foreground shrink-0" />
                  {s.shops?.name ?? s.shop_id}
                </div>
              ))}
              {shops.length > 3 && (
                <div className="text-xs text-muted-foreground">+{shops.length - 3} mais</div>
              )}
            </div>
          </div>
        )}

        {/* Metrics */}
        {shops.length > 0 && (
          <div className="border-t border-border mt-3 pt-3 space-y-1.5">
            {loadingMetrics ? (
              <div className="space-y-1.5">
                <div className="h-3.5 w-28 rounded bg-muted animate-pulse" />
                <div className="h-3.5 w-20 rounded bg-muted animate-pulse" />
                <div className="h-3.5 w-24 rounded bg-muted animate-pulse" />
              </div>
            ) : metrics ? (
              <>
                {/* Lucro */}
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Lucro mês</span>
                  <span className={`text-xs font-semibold ${metrics.lucro >= 0 ? "text-emerald-500" : "text-destructive"}`}>
                    {fmt(metrics.lucro, "USD")}
                  </span>
                </div>

                {/* Taxa de estorno */}
                {metrics.totalPedidos > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Estornos</span>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md ${
                      metrics.totalEstornos > 0
                        ? "bg-yellow-500/10 text-yellow-600 border border-yellow-500/20"
                        : "bg-muted text-muted-foreground"
                    }`}>
                      {(metrics.taxaEstorno * 100).toFixed(1)}%
                      {metrics.totalEstornos > 0 && ` (${metrics.totalEstornos})`}
                    </span>
                  </div>
                )}

                {/* Tempo de repasse */}
                {metrics.payoutLag.some((p: any) => p.days != null) && (
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium shrink-0 pt-0.5">Repasse</span>
                    <div className="text-right space-y-0.5">
                      {metrics.payoutLag.map((p: any) => (
                        <div key={p.shop_id} className="text-[10px] text-muted-foreground">
                          {metrics.payoutLag.length > 1 && <span className="font-medium text-foreground/70">{p.shopName}: </span>}
                          {p.days != null ? (
                            <span className="font-semibold text-foreground">D+{p.days}</span>
                          ) : (
                            <span>—</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </div>
        )}
      </Link>

      {/* Hover actions */}
      <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
        <button
          onClick={(e) => { e.preventDefault(); onEdit(); }}
          className="text-[11px] px-2 h-6 rounded-md bg-background border border-border text-muted-foreground hover:text-foreground"
        >
          editar
        </button>
        <button
          onClick={(e) => { e.preventDefault(); onDelete(); }}
          className="text-[11px] px-2 h-6 rounded-md bg-background border border-border text-destructive hover:text-destructive"
        >
          excluir
        </button>
      </div>
    </div>
  );
}

// ─── Editor modal ─────────────────────────────────────────────────────────────

type ShopEntry = { shop_id: string; payout_days: number; payment_days: number };

function LgCardEditor({
  card,
  saveError,
  onClose,
  onSave,
  onDelete,
}: {
  card: any;
  saveError: string | null;
  onClose: () => void;
  onSave: (payload: { card: any; shops: ShopEntry[] }) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const listShopsFn = useServerFn(listAllShopsForPicker);
  const { data: allShops = [] } = useQuery({ queryKey: ["all-shops-picker"], queryFn: () => listShopsFn() }) as { data: any[] };

  const [name, setName]           = useState(card?.name ?? "");
  const [description, setDesc]    = useState(card?.description ?? "");
  const [status, setStatus]       = useState<any>(card?.status ?? "ativo");
  const [country, setCountry]     = useState(card?.country ?? "");
  const [tag, setTag]             = useState(card?.tag ?? "");
  const [logoUrl, setLogoUrl]     = useState(card?.logo_url ?? "");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving]       = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Selected shops: map of shop_id → config
  const [selectedShops, setSelectedShops] = useState<Record<string, ShopEntry>>(() => {
    const init: Record<string, ShopEntry> = {};
    for (const s of (card?.card_shops ?? [])) {
      init[s.shop_id] = { shop_id: s.shop_id, payout_days: s.payout_days ?? 10, payment_days: s.payment_days ?? 7 };
    }
    return init;
  });

  // Loja Matriz (ads + tráfego)
  const [matrizShopId, setMatrizShopId] = useState<string>(card?.matriz_shop_id ?? "");

  useEscapeToClose(onClose);

  const toggleShop = (shopId: string) => {
    setSelectedShops((prev) => {
      if (prev[shopId]) {
        const next = { ...prev };
        delete next[shopId];
        return next;
      }
      return { ...prev, [shopId]: { shop_id: shopId, payout_days: 10, payment_days: 7 } };
    });
  };

  const uploadLogo = async (file: File) => {
    setUploading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");
      const safeName = file.name.replace(/[^\w.\-]+/g, "_");
      const path = `${u.user.id}/shop-logos/${Date.now()}_${safeName}`;
      const { error } = await supabase.storage.from("project-attachments").upload(path, file, { upsert: false });
      if (error) throw error;
      const { data: signed } = await supabase.storage.from("project-attachments").createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
      setLogoUrl(signed?.signedUrl ?? "");
    } catch (e: any) {
      alert(e.message ?? "Erro ao fazer upload");
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const selectedIds = Object.keys(selectedShops);
      await onSave({
        card: {
          name:           name.trim(),
          description:    description.trim() || null,
          status,
          country:        country || null,
          tag:            tag.trim() || null,
          logo_url:       logoUrl || null,
          matriz_shop_id: (selectedIds.length > 1 && matrizShopId) ? matrizShopId : (selectedIds[0] ?? null),
        },
        shops: Object.values(selectedShops),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-background rounded-2xl border border-border w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-base font-semibold">{card ? "Editar card" : "Novo card"}</h2>
          <button onClick={onClose} className="size-8 rounded-lg bg-muted hover:bg-accent grid place-items-center text-muted-foreground transition-colors">
            <X className="size-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div
              onClick={() => fileRef.current?.click()}
              className="size-14 rounded-xl border border-border bg-muted cursor-pointer hover:border-primary/40 transition-colors grid place-items-center shrink-0 overflow-hidden"
            >
              {logoUrl
                ? <img src={logoUrl} alt="logo" className="size-full object-cover" />
                : uploading
                  ? <div className="size-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  : <Upload className="size-5 text-muted-foreground" />}
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo(f); }} />
            {logoUrl && (
              <button onClick={() => setLogoUrl("")} className="text-xs text-destructive hover:underline">Remover</button>
            )}
          </div>

          {/* Name */}
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Nome *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full h-9 rounded-xl border border-border bg-card text-foreground text-sm px-3 focus:outline-none focus:border-primary"
              placeholder="Nome do card"
              maxLength={120}
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Descrição</label>
            <textarea
              value={description}
              onChange={(e) => setDesc(e.target.value)}
              rows={2}
              className="w-full rounded-xl border border-border bg-card text-foreground text-sm px-3 py-2 focus:outline-none focus:border-primary resize-none"
              placeholder="Descrição opcional"
            />
          </div>

          {/* Status + Country */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                className="w-full h-9 rounded-xl border border-border bg-card text-foreground text-sm px-3 focus:outline-none focus:border-primary"
              >
                {LG_STATUSES.map((s) => (
                  <option key={s} value={s}>{STATUS_META[s]?.label ?? s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">País</label>
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="w-full h-9 rounded-xl border border-border bg-card text-foreground text-sm px-3 focus:outline-none focus:border-primary"
              >
                <option value="">—</option>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.flag} {c.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Tag */}
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Tag</label>
            <input
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              className="w-full h-9 rounded-xl border border-border bg-card text-foreground text-sm px-3 focus:outline-none focus:border-primary"
              placeholder="Ex: principal, teste, b2b"
              maxLength={40}
            />
          </div>

          {/* Shop picker */}
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-2">Lojas conectadas</label>
            {(allShops as any[]).length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhuma loja cadastrada. Crie lojas primeiro na seção Lojas.</p>
            ) : (
              <div className="rounded-xl border border-border divide-y divide-border max-h-48 overflow-y-auto">
                {(allShops as any[]).map((shop: any) => {
                  const selected = Boolean(selectedShops[shop.id]);
                  return (
                    <button
                      key={shop.id}
                      type="button"
                      onClick={() => toggleShop(shop.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 ${selected ? "bg-primary/5" : ""}`}
                    >
                      <div className={`size-4 rounded border flex items-center justify-center shrink-0 transition-colors ${selected ? "bg-primary border-primary" : "border-border"}`}>
                        {selected && <Check className="size-3 text-primary-foreground" />}
                      </div>
                      <Store className="size-3.5 text-muted-foreground shrink-0" />
                      <span className="text-sm truncate">{shop.name}</span>
                      {shop.tag && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20 ml-auto shrink-0">
                          {shop.tag}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Loja Matriz (only when 2+ shops selected) */}
          {Object.keys(selectedShops).length > 1 && (
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                Loja Matriz <span className="text-muted-foreground/60 font-normal">(recebe todo o tráfego · usada para ads e conversão)</span>
              </label>
              <select
                value={matrizShopId}
                onChange={(e) => setMatrizShopId(e.target.value)}
                className="w-full h-9 rounded-xl border border-border bg-card text-foreground text-sm px-3 focus:outline-none focus:border-primary"
              >
                <option value="">— Selecionar</option>
                {Object.keys(selectedShops).map((shopId) => {
                  const shop = (allShops as any[]).find((s: any) => s.id === shopId);
                  return <option key={shopId} value={shopId}>{shop?.name ?? shopId}</option>;
                })}
              </select>
            </div>
          )}

          {saveError && (
            <p className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">{saveError}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 p-5 border-t border-border">
          {onDelete && (
            <button
              onClick={onDelete}
              className="text-sm text-destructive hover:text-destructive/80 transition-colors mr-auto"
            >
              Excluir
            </button>
          )}
          <button onClick={onClose} className="h-9 px-4 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground transition-colors ml-auto">
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="h-9 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 flex items-center gap-1.5"
          >
            {saving && <div className="size-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            {card ? "Salvar" : "Criar"}
          </button>
        </div>
      </div>
    </div>
  );
}
