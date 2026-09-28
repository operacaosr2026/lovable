import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Bell, BellRing, Loader2, Moon, Send, Share, Smartphone, SquarePlus, Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { describeUserAgent } from "@/lib/user-agent";
import { formatDateTimeUS } from "@/lib/timezone";
import {
  getNotificationSettings, removePushSubscription, saveNotificationSettings, savePushSubscription, sendTestPush,
} from "@/lib/notification-settings.functions";

export const Route = createFileRoute("/settings/notificacoes")({
  component: NotificacoesPage,
});

type Settings = Awaited<ReturnType<typeof getNotificationSettings>>;
type SettingsPatch = { muted?: string[]; dnd?: { enabled: boolean; start: string; end: string }; timezone?: string; profitTimes?: string[] };

// ─── Detecção do aparelho ─────────────────────────────────────────────────────

function isIOS() {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function isStandalone() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;
}
function pushSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}
function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

type DeviceState = "loading" | "unsupported" | "ios-install" | "active" | "needs-permission" | "denied";

// ─── Página ───────────────────────────────────────────────────────────────────

function NotificacoesPage() {
  const qc = useQueryClient();
  const getFn = useServerFn(getNotificationSettings);
  const saveFn = useServerFn(saveNotificationSettings);
  const q = useQuery({ queryKey: ["notification-settings"], queryFn: () => getFn() });
  const s = q.data;

  const save = useMutation({
    mutationFn: (patch: SettingsPatch) => saveFn({ data: patch }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notification-settings"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar"),
  });

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto pb-20 space-y-6">
      <header>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Notificações</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Escolha o que você quer receber no sino e como notificação no celular.
        </p>
      </header>

      {q.isLoading || !s ? (
        <div className="premium-card p-6"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>
      ) : !s.hasBell ? (
        <section className="premium-card p-6 text-sm text-muted-foreground">
          Você ainda não tem acesso às notificações. Peça ao administrador para liberar em Configurações → Membros.
        </section>
      ) : (
        <>
          <DeviceCard settings={s} />
          <CategoriesCard settings={s} onSave={(muted) => save.mutate({ muted })}
            onSaveProfitTimes={(profitTimes) => save.mutate({ profitTimes })} saving={save.isPending} />
          <QuietHoursCard settings={s} saving={save.isPending} onSave={(dnd) => save.mutate({ dnd })} />
          <DevicesCard settings={s} />
        </>
      )}
    </div>
  );
}

// ─── Este dispositivo ─────────────────────────────────────────────────────────

function DeviceCard({ settings }: { settings: Settings }) {
  const qc = useQueryClient();
  const subscribeFn = useServerFn(savePushSubscription);
  const removeFn = useServerFn(removePushSubscription);
  const testFn = useServerFn(sendTestPush);
  const [state, setState] = useState<DeviceState>("loading");
  const [busy, setBusy] = useState(false);

  // Estado real do aparelho: permissão do navegador + inscrição de push que
  // ainda vale no servidor.
  const detect = useCallback(async () => {
    if (isIOS() && !isStandalone()) return setState("ios-install");
    if (!pushSupported()) return setState("unsupported");
    if (Notification.permission === "denied") return setState("denied");
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = await reg?.pushManager.getSubscription();
    const known = sub && settings.devices.some((d) => d.endpoint === sub.endpoint && d.active);
    setState(Notification.permission === "granted" && known ? "active" : "needs-permission");
  }, [settings.devices]);
  useEffect(() => { detect().catch(() => setState("needs-permission")); }, [detect]);

  const enable = async () => {
    if (!settings.push.configured || !settings.push.publicKey) {
      return toast.error("Push ainda não configurado no servidor (faltam as chaves VAPID).");
    }
    setBusy(true);
    try {
      // A permissão tem que ser pedida direto no toque (exigência do iPhone).
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setState(permission === "denied" ? "denied" : "needs-permission"); return; }
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription())
        ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(settings.push.publicKey) });
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await subscribeFn({ data: {
        endpoint: json.endpoint, keys: json.keys,
        label: describeUserAgent(navigator.userAgent) + (isStandalone() ? " (app)" : ""),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      } });
      toast.success("Notificações ativadas neste dispositivo");
      await qc.invalidateQueries({ queryKey: ["notification-settings"] });
    } catch (e: any) {
      toast.error(e.message ?? "Não foi possível ativar as notificações");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await removeFn({ data: { endpoint: sub.endpoint } });
        await sub.unsubscribe();
      }
      toast.success("Notificações desativadas neste dispositivo");
      await qc.invalidateQueries({ queryKey: ["notification-settings"] });
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao desativar");
    } finally {
      setBusy(false);
    }
  };

  const test = useMutation({
    mutationFn: () => testFn(),
    onSuccess: (r) => r.sent
      ? toast.success(`Notificação de teste enviada (${r.sent} dispositivo${r.sent > 1 ? "s" : ""})`)
      : toast.error("O serviço de push recusou o envio — veja a lista de dispositivos"),
    onError: (e: any) => toast.error(e.message ?? "Erro ao enviar o teste"),
  });

  const STATUS: Record<DeviceState, { dot: string; label: string }> = {
    loading: { dot: "bg-muted-foreground", label: "Verificando…" },
    unsupported: { dot: "bg-muted-foreground", label: "Não compatível" },
    "ios-install": { dot: "bg-warning", label: "Instale o app para ativar" },
    active: { dot: "bg-success", label: "Ativas" },
    "needs-permission": { dot: "bg-warning", label: "Permissão necessária" },
    denied: { dot: "bg-destructive", label: "Bloqueadas" },
  };
  const st = STATUS[state];

  return (
    <section className="premium-card p-6">
      <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
        <div className="flex items-center gap-2">
          <Smartphone className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Notificações neste dispositivo</h2>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-full bg-surface border border-border font-medium">
          <span className={`size-2 rounded-full ${st.dot}`} />{st.label}
        </span>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Receba os avisos no celular ou no computador mesmo com o sistema fechado.
      </p>

      {state === "ios-install" ? (
        <div className="rounded-lg border border-border p-4 bg-surface text-sm space-y-2">
          <p className="font-medium">No iPhone, as notificações só funcionam com o app instalado:</p>
          <ol className="space-y-1.5 text-xs text-muted-foreground">
            <li className="flex items-center gap-2">1. Toque em <Share className="size-3.5 inline text-foreground" /> <b className="text-foreground">Compartilhar</b> no Safari.</li>
            <li className="flex items-center gap-2">2. Escolha <SquarePlus className="size-3.5 inline text-foreground" /> <b className="text-foreground">Adicionar à Tela de Início</b>.</li>
            <li>3. Abra o SRX Growth pelo ícone e volte aqui em Configurações → Notificações.</li>
          </ol>
          <p className="text-[11px] text-muted-foreground">Precisa do iOS 16.4 ou mais novo.</p>
        </div>
      ) : state === "unsupported" ? (
        <div className="rounded-lg border border-border p-4 bg-surface text-xs text-muted-foreground">
          Este navegador não suporta notificações push. Use o Chrome, Edge, Firefox ou Safari atualizado.
        </div>
      ) : state === "denied" ? (
        <div className="rounded-lg border border-border p-4 bg-surface text-xs text-muted-foreground">
          As notificações foram bloqueadas para este site. Libere nas configurações do navegador
          {isIOS() ? " (Ajustes → Notificações → SRX Growth)" : " (ícone de cadeado ao lado do endereço → Notificações)"} e volte aqui.
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 mt-4">
        {state === "needs-permission" && (
          <button onClick={enable} disabled={busy}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <BellRing className="size-3.5" />}
            Ativar notificações neste dispositivo
          </button>
        )}
        {state === "active" && (
          <>
            <button onClick={() => test.mutate()} disabled={test.isPending}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
              {test.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              Enviar notificação de teste
            </button>
            <button onClick={disable} disabled={busy}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-md text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50">
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              Desativar neste dispositivo
            </button>
          </>
        )}
      </div>
    </section>
  );
}

// ─── O que receber ────────────────────────────────────────────────────────────

function CategoriesCard({ settings, onSave, onSaveProfitTimes, saving }: {
  settings: Settings; onSave: (muted: string[]) => void; onSaveProfitTimes: (times: string[]) => void; saving: boolean;
}) {
  const toggle = (key: string, on: boolean) => {
    const muted = settings.categories.filter((c) => (c.key === key ? !on : !c.enabled)).map((c) => c.key);
    onSave(muted);
  };
  return (
    <section className="premium-card p-6">
      <div className="flex items-center gap-2 mb-1">
        <Bell className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">O que receber</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Vale para o sino e para o celular. Aparecem aqui só os tipos que o administrador liberou para você.
      </p>
      {!settings.categories.length ? (
        <div className="text-xs text-muted-foreground py-6 text-center border border-dashed border-border rounded-lg">
          Nenhum tipo de notificação liberado para você.
        </div>
      ) : (
        <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
          {settings.categories.map((c) => (
            <div key={c.key}>
              <label className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-surface transition-colors">
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm ${c.enabled ? "font-medium" : "text-muted-foreground"}`}>{c.label}</span>
                  <span className="block text-[11px] text-muted-foreground">{c.desc}</span>
                </span>
                <Switch checked={c.enabled} onCheckedChange={(on) => toggle(c.key, on)} />
              </label>
              {c.key === "nt_lucro" && c.enabled && (
                <ProfitTimes initial={settings.profitTimes} timezone={settings.timezone} saving={saving} onSave={onSaveProfitTimes} />
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// Lucro do dia: até 3 horários.
function ProfitTimes({ initial, timezone, saving, onSave }: {
  initial: string[]; timezone: string; saving: boolean; onSave: (times: string[]) => void;
}) {
  const [times, setTimes] = useState<string[]>(() => [...initial, "", "", ""].slice(0, 3));
  useEffect(() => { setTimes([...initial, "", "", ""].slice(0, 3)); }, [initial.join(",")]);
  const filled = times.filter(Boolean);
  const changed = [...new Set(filled)].sort().join(",") !== [...initial].sort().join(",");
  return (
    <div className="px-4 pb-3 -mt-1 space-y-2">
      <p className="text-[11px] text-muted-foreground">Horários para receber o lucro de hoje (até 3, fuso {timezone.replace("_", " ")}):</p>
      <div className="flex flex-wrap items-center gap-2">
        {times.map((t, i) => (
          <input key={i} type="time" value={t} onChange={(e) => setTimes((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))}
            className="settings-input w-28" />
        ))}
        {changed && (
          <button onClick={() => onSave(filled)} disabled={saving}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
            {saving && <Loader2 className="size-3.5 animate-spin" />}Salvar horários
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Não perturbe ─────────────────────────────────────────────────────────────

function QuietHoursCard({ settings, saving, onSave }: {
  settings: Settings; saving: boolean; onSave: (dnd: { enabled: boolean; start: string; end: string }) => void;
}) {
  const [start, setStart] = useState(settings.dnd.start);
  const [end, setEnd] = useState(settings.dnd.end);
  useEffect(() => { setStart(settings.dnd.start); setEnd(settings.dnd.end); }, [settings.dnd.start, settings.dnd.end]);
  const changed = start !== settings.dnd.start || end !== settings.dnd.end;
  return (
    <section className="premium-card p-6">
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          <Moon className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Não perturbe</h2>
        </div>
        <Switch checked={settings.dnd.enabled} onCheckedChange={(on) => onSave({ enabled: on, start, end })} />
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Nesse horário nada chega no celular — os avisos continuam no sino. Fuso: {settings.timezone.replace("_", " ")}.
      </p>
      <div className={`flex flex-wrap items-end gap-3 ${settings.dnd.enabled ? "" : "opacity-50"}`}>
        <label className="text-xs text-muted-foreground space-y-1">
          <span className="block">De</span>
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="settings-input w-32" />
        </label>
        <label className="text-xs text-muted-foreground space-y-1">
          <span className="block">Até</span>
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="settings-input w-32" />
        </label>
        {changed && (
          <button onClick={() => onSave({ enabled: settings.dnd.enabled, start, end })} disabled={saving || !start || !end}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
            {saving && <Loader2 className="size-3.5 animate-spin" />}Salvar horário
          </button>
        )}
      </div>
    </section>
  );
}

// ─── Meus dispositivos ────────────────────────────────────────────────────────

function DevicesCard({ settings }: { settings: Settings }) {
  const qc = useQueryClient();
  const removeFn = useServerFn(removePushSubscription);
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => {
    if (!pushSupported()) return;
    navigator.serviceWorker.getRegistration("/").then((r) => r?.pushManager.getSubscription())
      .then((sub) => setCurrent(sub?.endpoint ?? null)).catch(() => {});
  }, [settings.devices]);
  const remove = useMutation({
    mutationFn: (id: string) => removeFn({ data: { id } }),
    onSuccess: () => { toast.success("Dispositivo removido"); qc.invalidateQueries({ queryKey: ["notification-settings"] }); },
    onError: (e: any) => toast.error(e.message ?? "Erro ao remover"),
  });
  return (
    <section className="premium-card p-6">
      <div className="flex items-center gap-2 mb-1">
        <Smartphone className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">Meus dispositivos</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">Onde as suas notificações chegam.</p>
      {!settings.devices.length ? (
        <div className="text-xs text-muted-foreground py-6 text-center border border-dashed border-border rounded-lg">
          Nenhum dispositivo ativado ainda.
        </div>
      ) : (
        <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
          {settings.devices.map((d) => (
            <div key={d.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate flex items-center gap-2">
                  {d.label ?? "Dispositivo"}
                  {d.endpoint === current && <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">este</span>}
                  {!d.active && <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive font-medium">inativo</span>}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Ativado em {formatDateTimeUS(d.createdAt)}{d.lastUsedAt ? ` · último envio ${formatDateTimeUS(d.lastUsedAt)}` : ""}
                </div>
              </div>
              <button onClick={() => remove.mutate(d.id)} disabled={remove.isPending} title="Remover"
                className="size-8 grid place-items-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
