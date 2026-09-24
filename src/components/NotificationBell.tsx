import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { Bell, AlertCircle, AlertTriangle, Info, X, CheckCheck } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { listNotifications, markNotificationsRead, dismissNotification } from "@/lib/notifications.functions";

type Notification = {
  id: string;
  level: "info" | "warning" | "error" | string;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
  read_at: string | null;
};

const LEVEL_STYLE: Record<string, { icon: typeof Info; cls: string }> = {
  error:   { icon: AlertCircle,   cls: "text-destructive bg-destructive/10" },
  warning: { icon: AlertTriangle, cls: "text-warning bg-warning/15" },
  info:    { icon: Info,          cls: "text-primary bg-primary/10" },
};

function timeAgo(iso: string): string {
  const min = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d} dia${d === 1 ? "" : "s"}`;
}

// Sino de notificações: problemas que precisam de atenção (token da Meta
// vencendo, sync com erro, reembolsos que não carregaram...). Cada item some
// sozinho quando o problema é resolvido.
export function NotificationBell({ className = "" }: { className?: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const listFn = useServerFn(listNotifications);
  const readFn = useServerFn(markNotificationsRead);
  const dismissFn = useServerFn(dismissNotification);
  const [open, setOpen] = useState(false);

  const { data: items = [] } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => listFn() as Promise<Notification[]>,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  });
  const unread = items.filter((n) => !n.read_at);

  const markRead = useMutation({
    mutationFn: (ids: string[]) => readFn({ data: { ids } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const dismiss = useMutation({
    mutationFn: (id: string) => dismissFn({ data: { id } }),
    onMutate: (id) => {
      qc.setQueryData<Notification[]>(["notifications"], (prev) => (prev ?? []).filter((n) => n.id !== id));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const onOpenChange = (o: boolean) => {
    setOpen(o);
    // Abriu o sino = viu tudo que está na lista; o contador zera.
    if (o && unread.length) markRead.mutate(unread.map((n) => n.id));
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          aria-label={unread.length ? `${unread.length} notificações não lidas` : "Notificações"}
          title="Notificações"
          className={`relative size-8 rounded-lg grid place-items-center text-sidebar-fg-muted hover:text-sidebar-fg hover:bg-sidebar-hover-bg transition-colors shrink-0 ${className}`}
        >
          <Bell className="size-4" />
          {unread.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold grid place-items-center leading-none">
              {unread.length > 9 ? "9+" : unread.length}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="w-[340px] max-w-[calc(100vw-24px)] p-0 overflow-hidden rounded-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-semibold">Notificações</span>
          {items.length > 0 && <span className="text-[11px] text-muted-foreground">{items.length} aberta{items.length === 1 ? "" : "s"}</span>}
        </div>
        <div className="max-h-[420px] overflow-y-auto scrollbar-thin">
          {items.length === 0 ? (
            <div className="px-4 py-10 flex flex-col items-center gap-2 text-center">
              <CheckCheck className="size-6 text-success" />
              <p className="text-xs text-muted-foreground">Tudo certo por aqui.</p>
            </div>
          ) : (
            items.map((n) => {
              const st = LEVEL_STYLE[n.level] ?? LEVEL_STYLE.info;
              const Icon = st.icon;
              return (
                <div key={n.id} className="group relative flex gap-3 px-4 py-3 border-b border-border last:border-b-0 hover:bg-surface-hover transition-colors">
                  <div className={`size-7 rounded-lg grid place-items-center shrink-0 ${st.cls}`}>
                    <Icon className="size-3.5" />
                  </div>
                  <button
                    className="flex-1 min-w-0 text-left disabled:cursor-default"
                    disabled={!n.link}
                    onClick={() => {
                      if (!n.link) return;
                      setOpen(false);
                      // Link externo (ex.: pedido no admin da Shopify) abre em nova aba.
                      if (/^https?:\/\//.test(n.link)) window.open(n.link, "_blank", "noopener,noreferrer");
                      else navigate({ href: n.link });
                    }}
                  >
                    <p className="text-xs font-semibold text-foreground leading-snug pr-5">{n.title}</p>
                    {n.body && <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{n.body}</p>}
                    <p className="text-[10px] text-muted-foreground/70 mt-1.5">{timeAgo(n.created_at)}</p>
                  </button>
                  <button
                    onClick={() => dismiss.mutate(n.id)}
                    title="Dispensar"
                    aria-label="Dispensar notificação"
                    className="absolute top-2.5 right-2.5 size-6 rounded-md grid place-items-center text-muted-foreground/60 hover:text-foreground hover:bg-muted opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
