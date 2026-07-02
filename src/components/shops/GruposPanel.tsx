import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Users, X, Upload, Store, MapPin } from "lucide-react";
import { listGroups, createGroup, updateGroup, deleteGroup, GROUP_STATUSES } from "@/lib/shop-groups.functions";
import { listShopifyStores } from "@/lib/shop-orders.functions";
import { supabase } from "@/integrations/supabase/client";
import { useEscapeToClose } from "@/hooks/use-escape-to-close";
import { useConfirm } from "@/components/ui/confirm-dialog";

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

export function GruposPanel() {
  const qc = useQueryClient();
  const listFn = useServerFn(listGroups);
  const createFn = useServerFn(createGroup);
  const updateFn = useServerFn(updateGroup);
  const deleteFn = useServerFn(deleteGroup);
  const confirm = useConfirm();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const listStoresFn = useServerFn(listShopifyStores);
  const { data } = useQuery({ queryKey: ["shop-groups"], queryFn: () => listFn() });
  const { data: shopifyStores = [] } = useQuery({ queryKey: ["shopify-stores"], queryFn: () => listStoresFn() });
  const groups = (data?.groups ?? []) as any[];

  const refresh = () => qc.invalidateQueries({ queryKey: ["shop-groups"] });

  const create = useMutation({
    mutationFn: (input: any) => createFn({ data: input }),
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: (input: any) => updateFn({ data: input }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: refresh,
  });

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-4">
        <p className="text-sm text-muted-foreground">
          {groups.length} {groups.length === 1 ? "grupo" : "grupos"}
        </p>
        <button
          onClick={() => { setEditing(null); setEditorOpen(true); }}
          className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5"
        >
          <Plus className="size-4" /> Novo grupo
        </button>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <Users className="size-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nenhum grupo criado ainda.</p>
          <button
            onClick={() => { setEditing(null); setEditorOpen(true); }}
            className="mt-4 h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-1.5"
          >
            <Plus className="size-4" /> Criar primeiro grupo
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {groups.map((g) => (
            <GroupCard
              key={g.id}
              group={g}
              shopifyStores={shopifyStores as any[]}
              onEdit={() => { setEditing(g); setEditorOpen(true); }}
              onDelete={() =>
                confirm(`Excluir grupo "${g.name}"?`).then((ok) => {
                  if (ok) remove.mutate(g.id);
                })
              }
            />
          ))}
        </div>
      )}

      {editorOpen && (
        <GroupEditor
          group={editing}
          saveError={saveError}
          onClose={() => { setEditorOpen(false); setSaveError(null); }}
          onSave={async (payload) => {
            setSaveError(null);
            try {
              if (editing) {
                await update.mutateAsync({ id: editing.id, patch: payload.group, stores: payload.stores });
              } else {
                await create.mutateAsync(payload);
              }
              setEditorOpen(false);
            } catch (err: any) {
              setSaveError(err?.message ?? "Erro ao salvar grupo");
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
    </>
  );
}

function GroupCard({ group, shopifyStores, onEdit, onDelete }: { group: any; shopifyStores: any[]; onEdit: () => void; onDelete: () => void }) {
  const st = STATUS_META[group.status] ?? STATUS_META.ativo;
  const stores: any[] = group.shop_group_stores ?? [];
  const matriz = stores.find((s) => s.role === "matriz");
  const sublojas = stores.filter((s) => s.role === "subloja");
  const country = COUNTRIES.find((c) => c.code === group.country);
  const storeName = (id: string) => {
    const s = shopifyStores.find((st) => st.id === id);
    return s?.name || s?.shop_domain || id;
  };

  return (
    <div className="group relative rounded-2xl border border-border bg-surface hover:border-primary/40 transition-colors overflow-hidden">
      <Link to="/shops/grupos/$groupId" params={{ groupId: group.id }} search={{ tab: "dashboard" as const, meta_connected: undefined }} className="block p-5">
        <div className="flex items-start gap-3 mb-3">
          <div className="size-12 rounded-xl grid place-items-center shrink-0 bg-primary/10 text-primary text-base font-semibold">
            {group.logo_url
              ? <img src={group.logo_url} alt="logo" className="size-12 rounded-xl object-cover" />
              : group.name?.[0]?.toUpperCase() ?? <Users className="size-6" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-base font-semibold leading-tight truncate flex items-center gap-1.5">
              <span className="truncate">{group.name}</span>
              {group.tag && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20 truncate max-w-[100px]">
                  {group.tag}
                </span>
              )}
            </div>
            {country ? (
              <div className="text-[11px] text-muted-foreground mt-0.5 inline-flex items-center gap-1">
                <span className="text-sm leading-none">{country.flag}</span> {country.label}
              </div>
            ) : group.country ? (
              <div className="text-[11px] text-muted-foreground mt-0.5 inline-flex items-center gap-1">
                <MapPin className="size-3" /> {group.country}
              </div>
            ) : null}
          </div>
          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md font-medium shrink-0" style={{ background: st.tint, color: st.accent }}>
            {st.label}
          </span>
        </div>

        {group.description && (
          <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{group.description}</p>
        )}

        <div className="space-y-1.5">
          {matriz ? (
            <div className="rounded-lg bg-primary/5 border border-primary/20 px-3 py-2 flex items-center gap-2">
              <Store className="size-3.5 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Matriz</div>
                <div className="text-xs font-medium truncate">{storeName(matriz.shopify_store_id)}</div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
              Sem loja matriz definida
            </div>
          )}

          {sublojas.length > 0 && (
            <div className="rounded-lg bg-muted/40 border border-border px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
                Sublojas ({sublojas.length})
              </div>
              <div className="space-y-1">
                {sublojas.map((s: any) => (
                  <div key={s.id} className="text-xs truncate flex items-center gap-1.5">
                    <Store className="size-3 text-muted-foreground shrink-0" />
                    {storeName(s.shopify_store_id)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Link>

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

type StoreEntry = { shopify_store_id: string; role: "matriz" | "subloja" };

function GroupEditor({ group, saveError, onClose, onSave, onDelete }: {
  group: any;
  saveError?: string | null;
  onClose: () => void;
  onSave: (payload: any) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
}) {
  const [name, setName] = useState(group?.name ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const [country, setCountry] = useState(group?.country ?? "");
  const [tag, setTag] = useState(group?.tag ?? "");
  const [status, setStatus] = useState<string>(group?.status ?? "ativo");
  const [logoUrl, setLogoUrl] = useState<string>(group?.logo_url ?? "");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const existingStores: StoreEntry[] = (group?.shop_group_stores ?? []).map((s: any) => ({
    shopify_store_id: s.shopify_store_id,
    role: s.role as "matriz" | "subloja",
  }));
  const [stores, setStores] = useState<StoreEntry[]>(existingStores);

  const listStoresFn = useServerFn(listShopifyStores);
  const { data: shopifyStores = [] } = useQuery({
    queryKey: ["shopify-stores"],
    queryFn: () => listStoresFn(),
  });

  useEscapeToClose(onClose);

  const onPickLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");
      const safeName = file.name.replace(/[^\w.\-]+/g, "_");
      const path = `${u.user.id}/group-logos/${Date.now()}_${safeName}`;
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

  const addStore = (shopify_store_id: string, role: "matriz" | "subloja") => {
    if (!shopify_store_id) return;
    if (stores.find((s) => s.shopify_store_id === shopify_store_id)) return;
    if (role === "matriz") {
      setStores((prev) => [
        { shopify_store_id, role: "matriz" },
        ...prev.filter((s) => s.role !== "matriz"),
      ]);
    } else {
      setStores((prev) => [...prev.filter((s) => s.role !== "matriz"), ...(prev.filter((s) => s.role === "matriz")), { shopify_store_id, role }]);
    }
  };

  const removeStore = (shopify_store_id: string) =>
    setStores((prev) => prev.filter((s) => s.shopify_store_id !== shopify_store_id));

  const save = () => onSave({
    group: {
      name: name.trim() || (group?.name ?? "Novo grupo"),
      description: description.trim() || null,
      country: country.trim() || null,
      tag: tag.trim() || null,
      status,
      logo_url: logoUrl || null,
    },
    stores,
  });

  const availableForMatriz = (shopifyStores as any[]).filter(
    (s) => !stores.find((st) => st.shopify_store_id === s.id && st.role !== "matriz")
  );
  const availableForSubloja = (shopifyStores as any[]).filter(
    (s) => !stores.find((st) => st.shopify_store_id === s.id)
  );

  const matriz = stores.find((s) => s.role === "matriz");
  const sublojas = stores.filter((s) => s.role === "subloja");

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl bg-popover border border-border shadow-xl max-h-[90vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <div className="text-base font-semibold">{group ? "Editar grupo" : "Novo grupo"}</div>
          <button onClick={onClose} className="size-7 rounded-md grid place-items-center hover:bg-muted text-muted-foreground">
            <X className="size-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Logo + nome */}
          <div className="flex items-center gap-3">
            {logoUrl ? (
              <img src={logoUrl} alt="logo" className="size-16 rounded-xl object-cover border border-border" />
            ) : (
              <div className="size-16 rounded-xl bg-muted grid place-items-center">
                <Users className="size-7 text-muted-foreground" />
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
            placeholder="Nome do grupo"
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
              {GROUP_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </select>
          </div>
          <input
            value={tag}
            onChange={(e) => setTag(e.target.value.slice(0, 40))}
            placeholder="Tag (ex: principal, teste...)"
            className="w-full px-3 h-9 rounded-lg bg-surface border border-border text-sm outline-none focus:border-primary/50"
          />

          {/* Lojas */}
          <div className="space-y-3 pt-1">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Lojas do grupo</div>

            {shopifyStores.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground text-center">
                Nenhuma loja no Banco de Lojas. Conecte uma loja primeiro.
              </div>
            ) : (
              <>
                {/* Matriz */}
                <div>
                  <div className="text-xs font-medium mb-1.5 flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-primary inline-block" /> Loja Matriz
                  </div>
                  {matriz ? (
                    <div className="flex items-center gap-2 rounded-lg bg-primary/5 border border-primary/20 px-3 py-2">
                      <Store className="size-3.5 text-primary shrink-0" />
                      <span className="text-sm flex-1 truncate">
                        {(shopifyStores as any[]).find((s) => s.id === matriz.shopify_store_id)?.name
                          || (shopifyStores as any[]).find((s) => s.id === matriz.shopify_store_id)?.shop_domain
                          || matriz.shopify_store_id}
                      </span>
                      <button onClick={() => removeStore(matriz.shopify_store_id)} className="text-muted-foreground hover:text-destructive shrink-0">
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ) : (
                    <StorePickerRow
                      placeholder="Selecionar loja matriz..."
                      stores={availableForMatriz}
                      onSelect={(id) => addStore(id, "matriz")}
                    />
                  )}
                </div>

                {/* Sublojas */}
                <div>
                  <div className="text-xs font-medium mb-1.5 flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-muted-foreground inline-block" /> Sublojas
                  </div>
                  <div className="space-y-1.5">
                    {sublojas.map((s) => {
                      const store = (shopifyStores as any[]).find((st) => st.id === s.shopify_store_id);
                      return (
                        <div key={s.shopify_store_id} className="flex items-center gap-2 rounded-lg bg-muted/40 border border-border px-3 py-2">
                          <Store className="size-3.5 text-muted-foreground shrink-0" />
                          <span className="text-sm flex-1 truncate">{store?.name || store?.shop_domain || s.shopify_store_id}</span>
                          <button onClick={() => removeStore(s.shopify_store_id)} className="text-muted-foreground hover:text-destructive shrink-0">
                            <X className="size-3.5" />
                          </button>
                        </div>
                      );
                    })}
                    {availableForSubloja.length > 0 && (
                      <StorePickerRow
                        placeholder="Adicionar subloja..."
                        stores={availableForSubloja}
                        onSelect={(id) => addStore(id, "subloja")}
                      />
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {saveError && (
          <div className="px-5 py-2 text-xs text-destructive bg-destructive/5 border-t border-destructive/20">
            {saveError}
          </div>
        )}
        <div className="flex justify-between items-center px-5 py-3 border-t border-border shrink-0">
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

function StorePickerRow({ placeholder, stores, onSelect }: {
  placeholder: string;
  stores: any[];
  onSelect: (id: string) => void;
}) {
  return (
    <select
      value=""
      onChange={(e) => { if (e.target.value) onSelect(e.target.value); }}
      className="w-full px-2 h-9 rounded-lg bg-surface border border-dashed border-border text-sm text-muted-foreground outline-none cursor-pointer"
    >
      <option value="">{placeholder}</option>
      {stores.map((s) => (
        <option key={s.id} value={s.id}>{s.name || s.shop_domain}</option>
      ))}
    </select>
  );
}
