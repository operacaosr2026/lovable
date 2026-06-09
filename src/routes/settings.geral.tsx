import { createFileRoute } from "@tanstack/react-router";
import { useState, type ChangeEvent } from "react";
import { useAppSettings, HOME_OPTIONS, TIMEZONE_OPTIONS, LANGUAGE_OPTIONS, DATE_FORMAT_OPTIONS } from "@/lib/app-settings";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Upload, Image as ImageIcon, Eye, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/settings/geral")({
  component: GeralPage,
});

function GeralPage() {
  const { settings, update, preview, clearPreview, loading } = useAppSettings();
  const { user } = useAuth();
  const [uploading, setUploading] = useState<"logo" | "favicon" | null>(null);
  const [colorDraft, setColorDraft] = useState<string | null>(null);

  if (loading || !settings) {
    return (
      <div className="p-10 grid place-items-center text-muted-foreground">
        <Loader2 className="animate-spin size-5" />
      </div>
    );
  }

  const onUpload = async (kind: "logo" | "favicon", e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploading(kind);
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `${user.id}/${kind}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("app-assets").upload(path, file, {
        upsert: true,
        contentType: file.type,
      });
      if (error) throw error;
      const { data: signed } = await supabase.storage.from("app-assets").createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
      if (!signed?.signedUrl) throw new Error("Falha ao gerar URL");
      await update(kind === "logo" ? { logo_url: signed.signedUrl } : { favicon_url: signed.signedUrl });
      toast.success(`${kind === "logo" ? "Logo" : "Favicon"} atualizado`);
    } catch (err: any) {
      toast.error(err.message ?? "Falha no upload");
    } finally {
      setUploading(null);
      e.target.value = "";
    }
  };

  const hexFromOklch = (c: string) => {
    // For HTML color input, fall back to extracting hex if any, otherwise neutral
    const m = c.match(/#([0-9a-f]{6})/i);
    return m ? m[0] : "#7c3aed";
  };

  const onColorInput = (hex: string) => {
    setColorDraft(hex);
    preview({ primary_color: hex });
  };

  const onColorCommit = async () => {
    if (!colorDraft) return;
    await update({ primary_color: colorDraft });
    setColorDraft(null);
    toast.success("Cor principal atualizada");
  };

  const currentColorValue = colorDraft ?? settings.primary_color;

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto pb-20">
      <header className="mb-8">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Geral</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configurações globais da plataforma. Mudanças visuais são aplicadas em tempo real.
        </p>
      </header>

      <div className="grid md:grid-cols-3 gap-6">
        {/* Left: form */}
        <div className="md:col-span-2 space-y-4">
          <Card title="Identidade">
            <Field label="Nome do aplicativo">
              <input
                type="text"
                className="settings-input"
                defaultValue={settings.app_name}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== settings.app_name) update({ app_name: v });
                }}
              />
            </Field>

            <Field label="Logo do aplicativo">
              <div className="flex items-center gap-4">
                <div className="size-16 rounded-xl border border-border bg-surface grid place-items-center overflow-hidden">
                  {settings.logo_url ? (
                    <img src={settings.logo_url} alt="Logo" className="size-full object-contain p-2" />
                  ) : (
                    <ImageIcon className="size-5 text-muted-foreground" />
                  )}
                </div>
                <label className="settings-btn cursor-pointer">
                  {uploading === "logo" ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
                  <span>{uploading === "logo" ? "Enviando..." : "Enviar logo"}</span>
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => onUpload("logo", e)} />
                </label>
                {settings.logo_url && (
                  <button className="text-xs text-muted-foreground hover:text-destructive" onClick={() => update({ logo_url: null })}>
                    Remover
                  </button>
                )}
              </div>
            </Field>

            <Field label="Favicon">
              <div className="flex items-center gap-4">
                <div className="size-10 rounded-md border border-border bg-surface grid place-items-center overflow-hidden">
                  {settings.favicon_url ? (
                    <img src={settings.favicon_url} alt="Favicon" className="size-full object-contain p-1" />
                  ) : (
                    <ImageIcon className="size-4 text-muted-foreground" />
                  )}
                </div>
                <label className="settings-btn cursor-pointer">
                  {uploading === "favicon" ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
                  <span>{uploading === "favicon" ? "Enviando..." : "Enviar favicon"}</span>
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => onUpload("favicon", e)} />
                </label>
                {settings.favicon_url && (
                  <button className="text-xs text-muted-foreground hover:text-destructive" onClick={() => update({ favicon_url: null })}>
                    Remover
                  </button>
                )}
              </div>
            </Field>

            <Field label="Cor principal">
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={hexFromOklch(currentColorValue)}
                  onChange={(e) => onColorInput(e.target.value)}
                  onBlur={onColorCommit}
                  className="size-10 rounded-md cursor-pointer bg-transparent border border-border"
                />
                <input
                  type="text"
                  className="settings-input flex-1"
                  value={currentColorValue}
                  onChange={(e) => {
                    setColorDraft(e.target.value);
                    preview({ primary_color: e.target.value });
                  }}
                  onBlur={onColorCommit}
                  placeholder="oklch(0.58 0.22 295) ou #7c3aed"
                />
                {colorDraft && (
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setColorDraft(null);
                      clearPreview();
                    }}
                  >
                    Cancelar
                  </button>
                )}
              </div>
            </Field>
          </Card>

          <Card title="Localização">
            <Field label="Idioma">
              <select
                className="settings-input"
                value={settings.language}
                onChange={(e) => update({ language: e.target.value })}
              >
                {LANGUAGE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Fuso horário">
              <select
                className="settings-input"
                value={settings.timezone}
                onChange={(e) => update({ timezone: e.target.value })}
              >
                {TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            </Field>
            <Field label="Formato de data">
              <select
                className="settings-input"
                value={settings.date_format}
                onChange={(e) => update({ date_format: e.target.value })}
              >
                {DATE_FORMAT_OPTIONS.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </Field>
          </Card>

          <Card title="Comportamento">
            <Field label="Página inicial padrão">
              <select
                className="settings-input"
                value={settings.default_home}
                onChange={(e) => update({ default_home: e.target.value })}
              >
                {HOME_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>
          </Card>
        </div>

        {/* Right: preview panel */}
        <div className="md:col-span-1">
          <div className="premium-card p-5 sticky top-6">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
              <Eye className="size-3.5" />
              Pré-visualização ao vivo
            </div>
            <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
              <div className="flex items-center gap-2.5">
                <div className="size-9 rounded-lg overflow-hidden grid place-items-center" style={{ background: settings.primary_color }}>
                  {settings.logo_url ? (
                    <img src={settings.logo_url} alt="" className="size-full object-contain p-1" />
                  ) : (
                    <span className="text-white text-xs font-bold">{settings.app_name.slice(0, 2).toUpperCase()}</span>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-bold truncate">{settings.app_name}</div>
                  <div className="text-[11px] text-muted-foreground">Visão de exemplo</div>
                </div>
              </div>
              <button
                className="w-full h-9 rounded-md text-xs font-medium text-white"
                style={{ background: settings.primary_color }}
              >
                Botão primário
              </button>
              <div className="flex items-center gap-2 text-xs">
                <div className="size-4 rounded border border-border bg-surface grid place-items-center overflow-hidden">
                  {settings.favicon_url && <img src={settings.favicon_url} alt="" className="size-full object-contain" />}
                </div>
                <span className="text-muted-foreground">{settings.app_name} — favicon</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="premium-card p-6">
      <h2 className="text-sm font-semibold mb-5">{title}</h2>
      <div className="space-y-5">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-muted-foreground mb-1.5">{label}</div>
      {children}
    </label>
  );
}
