import { useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageShell, PageHeader } from "@/components/PageHeader";
import { Plus, Search, Store, MapPin, ListChecks, Repeat, Package, X, Upload, LayoutGrid, List } from "lucide-react";
import { listShops, createShop, updateShop, deleteShop, SHOP_STATUSES } from "@/lib/shops.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/shops/")({
  component: ShopsDashboard,
});

const STATUS_META: Record<string, { label: string; tint: string; accent: string }> = {
  ativa:     { label: "Ativa",     tint: "oklch(0.96 0.04 155)", accent: "oklch(0.5 0.13 155)" },
  pausada:   { label: "Pausada",   tint: "oklch(0.96 0.03 75)",  accent: "oklch(0.55 0.16 65)" },
  arquivada: { label: "Arquivada", tint: "oklch(0.95 0.005 250)", accent: "oklch(0.45 0.015 260)" },
};

export const COUNTRIES: { code: string; label: string; flag: string }[] = [
  { code: "US", label: "Estados Unidos", flag: "🇺🇸" },
  { code: "CA", label: "Canadá",         flag: "🇨🇦" },
  { code: "GB", label: "Reino Unido",    flag: "🇬🇧" },
  { code: "BE", label: "Bélgica",        flag: "🇧🇪" },
  { code: "CH", label: "Suíça",          flag: "🇨🇭" },
  { code: "AU", label: "Austrália",      flag: "🇦🇺" },
];

export function getCountry(value?: string | null) {
  if (!value) return null;
  return COUNTRIES.find((c) => c.code === value || c.label === value) ?? null;
}

export function ShopTag({ tag }: { tag: string }) {
  return (
    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20 truncate max-w-[120px]">
      {tag}
    </span>
  );
}

function ShopsDashboard() {
  const qc = useQueryClient();
  const list = useServerFn(listShops);
  const createFn = useServerFn(createShop);
  const updateFn = useServerFn(updateShop);
  const deleteFn = useServerFn(deleteShop);

  const [search, setSearch] = useState("");
  const [fStatus, setFStatus] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"cards" | "list">("cards");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const { data } = useQuery({ queryKey: ["shops"], queryFn: () => list() });
  const shops = (data?.shops ?? []) as any[];

  const filtered = useMemo(() => {
    return shops.filter((s) => {
      if (fStatus !== "all" && s.status !== fStatus) return false;
      if (search && !s.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [shops, fStatus, search]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["shops"] });
  const create = useMutation({ mutationFn: (input: any) => createFn({ data: input }), onSuccess: refresh });
  const update = useMutation({ mutationFn: ({ id, patch }: any) => updateFn({ data: { id, patch } }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => deleteFn({ data: { id } }), onSuccess: refresh });

  return (
    <PageShell>
      <PageHeader
        title="Lojas"
        subtitle={`${filtered.length} ${filtered.length === 1 ? "loja" : "lojas"}`}
        actions={
          <button
            onClick={() => { setEditing(null); setEditorOpen(true); }}
            className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5"
          >
            <Plus className="size-4" /> Nova loja
          </button>
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="flex items-center gap-2 px-3 h-9 rounded-lg bg-surface border border-border flex-1 min-w-[220px]">
          <Search className="size-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar loja..."
            className="bg-transparent text-sm outline-none flex-1 placeholder:text-muted-foreground"
          />
        </div>
        <select
          value={fStatus}
          onChange={(e) => setFStatus(e.target.value)}
          className="h-9 px-2 rounded-lg bg-surface border border-border text-sm outline-none cursor-pointer"
        >
          <option value="all">Status</option>
          {SHOP_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </select>
        <div className="flex items-center rounded-lg border border-border bg-surface overflow-hidden">
          <button
            onClick={() => setViewMode("cards")}
            className={`h-9 px-2.5 flex items-center gap-1.5 text-sm transition-colors ${viewMode === "cards" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            title="Cards"
          >
            <LayoutGrid className="size-4" />
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={`h-9 px-2.5 flex items-center gap-1.5 text-sm transition-colors ${viewMode === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            title="Lista"
          >
            <List className="size-4" />
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <Store className="size-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nenhuma loja por aqui ainda.</p>
          <button
            onClick={() => { setEditing(null); setEditorOpen(true); }}
            className="mt-4 h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-1.5"
          >
            <Plus className="size-4" /> Criar primeira loja
          </button>
        </div>
      ) : viewMode === "cards" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((s) => (
            <ShopCard
              key={s.id}
              s={s}
              onEdit={() => { setEditing(s); setEditorOpen(true); }}
              onDelete={() => { if (confirm(`Excluir "${s.name}"? Isso remove a loja e tudo dentro dela.`)) remove.mutate(s.id); }}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-surface overflow-hidden">
          <div className="grid grid-cols-[1fr_120px_100px_100px_100px_80px] gap-3 px-4 py-2.5 border-b border-border bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
            <span>Loja</span>
            <span className="text-center">Status</span>
            <span className="text-center">Produtos</span>
            <span className="text-center">Tarefas</span>
            <span className="text-center">Rotinas</span>
            <span className="text-right">Saldo</span>
          </div>
          {filtered.map((s) => (
            <ShopListRow
              key={s.id}
              s={s}
              onEdit={() => { setEditing(s); setEditorOpen(true); }}
              onDelete={() => { if (confirm(`Excluir "${s.name}"? Isso remove a loja e tudo dentro dela.`)) remove.mutate(s.id); }}
            />
          ))}
        </div>
      )}

      {editorOpen && (
        <ShopEditor
          shop={editing}
          onClose={() => setEditorOpen(false)}
          onSave={async (patch) => {
            if (editing) await update.mutateAsync({ id: editing.id, patch });
            else await create.mutateAsync(patch);
            setEditorOpen(false);
          }}
          onDelete={editing ? async () => {
            if (confirm(`Excluir "${editing.name}"?`)) {
              await remove.mutateAsync(editing.id);
              setEditorOpen(false);
            }
          } : undefined}
        />
      )}
    </PageShell>
  );
}

function ShopCard({ s, onEdit, onDelete }: { s: any; onEdit: () => void; onDelete: () => void }) {
  const st = STATUS_META[s.status] ?? STATUS_META.ativa;
  return (
    <div className="group relative rounded-2xl border border-border bg-surface hover:border-primary/40 transition-colors overflow-hidden">
      <Link to="/shops/$shopId" params={{ shopId: s.id }} className="block p-5">
        <div className="flex items-start gap-3 mb-3">
          {s.logo_url ? (
            <img src={s.logo_url} alt={s.name} className="size-12 rounded-xl object-cover shrink-0 border border-border" />
          ) : (
            <div className="size-12 rounded-xl grid place-items-center shrink-0 bg-primary/10 text-primary">
              <Store className="size-6" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-base font-semibold leading-tight truncate flex items-center gap-1.5">
              <span className="truncate">{s.name}</span>
              {s.tag && <ShopTag tag={s.tag} />}
            </div>
            {(() => {
              const c = getCountry(s.country);
              return c ? (
                <div className="text-[11px] text-muted-foreground mt-0.5 inline-flex items-center gap-1">
                  <span className="text-sm leading-none">{c.flag}</span> {c.label}
                </div>
              ) : s.country ? (
                <div className="text-[11px] text-muted-foreground mt-0.5 inline-flex items-center gap-1">
                  <MapPin className="size-3" /> {s.country}
                </div>
              ) : null;
            })()}
          </div>
          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md font-medium" style={{ background: st.tint, color: st.accent }}>
            {st.label}
          </span>
        </div>

        {s.description && (
          <p className="text-xs text-muted-foreground line-clamp-2 mb-3 min-h-[2rem]">{s.description}</p>
        )}

        <div className="mb-2 rounded-lg bg-primary/5 border border-primary/20 px-3 py-2 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Saldo atual</span>
          <span className={`text-base font-bold tabular-nums ${Number(s.balance) < 0 ? "text-rose-500" : "text-primary"}`}>
            {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(s.balance ?? 0))}
          </span>
        </div>
        {s.refundRate != null && (
          <div className="mb-2 rounded-lg bg-primary/5 border border-primary/20 px-3 py-2 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Taxa de estorno (30d)</span>
            <span className={`text-base font-bold tabular-nums ${s.refundRate > 0.5 ? "text-rose-500" : "text-emerald-500"}`}>
              {s.refundRate.toFixed(1)}%
            </span>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat icon={Package} label="Produtos" value={s.products} />
          <Stat icon={ListChecks} label="Tarefas" value={s.pendingTasks} />
          <Stat icon={Repeat} label="Rotinas hoje" value={s.routinesToday} />
        </div>
      </Link>
      <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => { e.preventDefault(); onEdit(); }}
          className="text-[11px] px-2 h-6 rounded-md bg-background border border-border text-muted-foreground hover:text-foreground"
        >
          editar
        </button>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: any) {
  return (
    <div className="rounded-lg bg-background border border-border py-2">
      <div className="flex items-center justify-center gap-1 text-muted-foreground">
        <Icon className="size-3" />
        <span className="text-xs tabular-nums font-semibold text-foreground">{value}</span>
      </div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}

function ShopListRow({ s, onEdit, onDelete }: { s: any; onEdit: () => void; onDelete: () => void }) {
  const st = STATUS_META[s.status] ?? STATUS_META.ativa;
  const c = getCountry(s.country);
  return (
    <div className="group relative grid grid-cols-[1fr_120px_100px_100px_100px_80px] gap-3 px-4 py-3 items-center border-b border-border last:border-b-0 hover:bg-muted/30 transition-colors">
      <Link to="/shops/$shopId" params={{ shopId: s.id }} className="flex items-center gap-3 min-w-0">
        {s.logo_url ? (
          <img src={s.logo_url} alt={s.name} className="size-9 rounded-lg object-cover shrink-0 border border-border" />
        ) : (
          <div className="size-9 rounded-lg grid place-items-center shrink-0 bg-primary/10 text-primary">
            <Store className="size-4" />
          </div>
        )}
        <div className="min-w-0">
          <div className="text-sm font-medium truncate flex items-center gap-1.5">
            <span className="truncate">{s.name}</span>
            {s.tag && <ShopTag tag={s.tag} />}
          </div>
          <div className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
            {c ? (
              <>
                <span className="text-sm leading-none">{c.flag}</span> {c.label}
              </>
            ) : s.country ? (
              <>
                <MapPin className="size-3" /> {s.country}
              </>
            ) : null}
          </div>
        </div>
      </Link>
      <div className="flex justify-center">
        <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md font-medium" style={{ background: st.tint, color: st.accent }}>
          {st.label}
        </span>
      </div>
      <div className="flex items-center justify-center gap-1 text-muted-foreground">
        <Package className="size-3" />
        <span className="text-xs tabular-nums font-semibold text-foreground">{s.products}</span>
      </div>
      <div className="flex items-center justify-center gap-1 text-muted-foreground">
        <ListChecks className="size-3" />
        <span className="text-xs tabular-nums font-semibold text-foreground">{s.pendingTasks}</span>
      </div>
      <div className="flex items-center justify-center gap-1 text-muted-foreground">
        <Repeat className="size-3" />
        <span className="text-xs tabular-nums font-semibold text-foreground">{s.routinesToday}</span>
      </div>
      <div className="text-right">
        <span className={`text-sm font-bold tabular-nums ${Number(s.balance) < 0 ? "text-rose-500" : "text-primary"}`}>
          {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(s.balance ?? 0))}
        </span>
      </div>
      <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity hidden group-hover:flex items-center gap-1">
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

function ShopEditor({ shop, onClose, onSave, onDelete }: {
  shop: any;
  onClose: () => void;
  onSave: (patch: any) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
}) {
  const [name, setName] = useState(shop?.name ?? "");
  const [description, setDescription] = useState(shop?.description ?? "");
  const [country, setCountry] = useState(shop?.country ?? "");
  const [tag, setTag] = useState(shop?.tag ?? "");
  const [status, setStatus] = useState<string>(shop?.status ?? "ativa");
  const [logoUrl, setLogoUrl] = useState<string>(shop?.logo_url ?? "");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onPickLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
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
    } catch (err: any) {
      alert("Erro ao enviar: " + err.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const save = () => onSave({
    name: name.trim() || (shop?.name ?? "Nova loja"),
    description: description.trim() || null,
    country: country.trim() || null,
    tag: tag.trim() || null,
    status,
    logo_url: logoUrl || null,
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl bg-popover border border-border shadow-xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="text-base font-semibold">{shop ? "Editar loja" : "Nova loja"}</div>
          <button onClick={onClose} className="size-7 rounded-md grid place-items-center hover:bg-muted text-muted-foreground">
            <X className="size-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center gap-3">
            {logoUrl ? (
              <img src={logoUrl} alt="logo" className="size-16 rounded-xl object-cover border border-border" />
            ) : (
              <div className="size-16 rounded-xl bg-muted grid place-items-center">
                <Store className="size-7 text-muted-foreground" />
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*" onChange={onPickLogo} className="hidden" />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="h-9 px-3 rounded-lg border border-border bg-surface text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <Upload className="size-3.5" /> {uploading ? "Enviando..." : "Logo"}
            </button>
          </div>

          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome da loja"
            className="w-full px-3 h-10 rounded-lg bg-surface border border-border text-sm outline-none focus:border-primary/50"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Descrição curta..."
            rows={2}
            className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm outline-none focus:border-primary/50 resize-none"
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="px-2 h-9 rounded-lg bg-surface border border-border text-sm outline-none cursor-pointer"
            >
              <option value="">País...</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>{c.flag}  {c.label}</option>
              ))}
            </select>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="px-2 h-9 rounded-lg bg-surface border border-border text-sm outline-none"
            >
              {SHOP_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </select>
          </div>
          <input
            value={tag}
            onChange={(e) => setTag(e.target.value.slice(0, 40))}
            placeholder="Tag (ex: principal, teste...)"
            className="w-full px-3 h-9 rounded-lg bg-surface border border-border text-sm outline-none focus:border-primary/50"
          />
        </div>

        <div className="flex justify-between items-center px-5 py-3 border-t border-border">
          {onDelete ? (
            <button onClick={onDelete} className="text-sm text-destructive hover:underline">Excluir</button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="h-9 px-4 rounded-lg text-sm hover:bg-muted">Cancelar</button>
            <button onClick={save} className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium">Salvar</button>
          </div>
        </div>
      </div>
    </div>
  );
}
