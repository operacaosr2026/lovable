import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Lock, LogOut, History, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/settings/seguranca")({
  component: SegurancaPage,
});

type LoginRow = { id: string; ip: string | null; user_agent: string | null; created_at: string };

function SegurancaPage() {
  const { user, signOut } = useAuth();
  const qc = useQueryClient();
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [changing, setChanging] = useState(false);
  const [revoking, setRevoking] = useState(false);

  const historyQ = useQuery({
    queryKey: ["login-history", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<LoginRow[]> => {
      const { data, error } = await supabase
        .from("login_history")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as LoginRow[];
    },
  });

  const clearMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("login_history").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["login-history"] });
      toast.success("Histórico limpo");
    },
  });

  const onChangePassword = async () => {
    if (pwd.length < 8) return toast.error("Senha deve ter ao menos 8 caracteres");
    if (pwd !== pwd2) return toast.error("As senhas não coincidem");
    setChanging(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pwd });
      if (error) throw error;
      toast.success("Senha alterada");
      setPwd("");
      setPwd2("");
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao alterar senha");
    } finally {
      setChanging(false);
    }
  };

  const onRevokeOthers = async () => {
    setRevoking(true);
    try {
      const { error } = await supabase.auth.signOut({ scope: "others" });
      if (error) throw error;
      toast.success("Outras sessões encerradas");
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao encerrar sessões");
    } finally {
      setRevoking(false);
    }
  };

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto pb-20 space-y-6">
      <header>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Segurança</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Gerencie sua senha, sessões ativas e histórico de acesso.
        </p>
      </header>

      <section className="premium-card p-6">
        <div className="flex items-center gap-2 mb-1">
          <Lock className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Alterar senha</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-4">Mínimo de 8 caracteres.</p>
        <div className="grid md:grid-cols-2 gap-3 max-w-xl">
          <input
            type="password"
            placeholder="Nova senha"
            className="settings-input"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
          />
          <input
            type="password"
            placeholder="Confirmar senha"
            className="settings-input"
            value={pwd2}
            onChange={(e) => setPwd2(e.target.value)}
          />
        </div>
        <button
          onClick={onChangePassword}
          disabled={changing || !pwd}
          className="mt-4 inline-flex items-center gap-2 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
        >
          {changing && <Loader2 className="size-3.5 animate-spin" />}
          Atualizar senha
        </button>
      </section>

      <section className="premium-card p-6">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <LogOut className="size-4 text-primary" />
            <h2 className="text-sm font-semibold">Sessões e dispositivos</h2>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Sua sessão atual está ativa neste navegador. Você pode encerrar todas as outras sessões em qualquer outro dispositivo.
        </p>
        <div className="rounded-lg border border-border p-4 bg-surface">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="text-sm font-medium">Sessão atual</div>
              <div className="text-xs text-muted-foreground mt-0.5 truncate max-w-md">{user?.email}</div>
              <div className="text-[11px] text-muted-foreground mt-1 truncate max-w-md">
                {typeof navigator !== "undefined" ? navigator.userAgent : ""}
              </div>
            </div>
            <span className="text-[11px] px-2 py-1 rounded-full bg-success/15 text-success font-medium">Ativa</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          <button
            onClick={onRevokeOthers}
            disabled={revoking}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-md border border-border bg-surface text-sm font-medium hover:bg-surface-hover disabled:opacity-50"
          >
            {revoking && <Loader2 className="size-3.5 animate-spin" />}
            Encerrar outras sessões
          </button>
          <button
            onClick={() => signOut()}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-md text-sm font-medium text-destructive hover:bg-destructive/10"
          >
            Sair desta sessão
          </button>
        </div>
      </section>

      <section className="premium-card p-6">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <History className="size-4 text-primary" />
            <h2 className="text-sm font-semibold">Histórico de login</h2>
          </div>
          {historyQ.data && historyQ.data.length > 0 && (
            <button
              onClick={() => clearMut.mutate()}
              className="text-xs text-muted-foreground hover:text-destructive inline-flex items-center gap-1"
            >
              <Trash2 className="size-3" /> Limpar
            </button>
          )}
        </div>
        <p className="text-xs text-muted-foreground mb-4">Últimos 20 acessos registrados.</p>
        {historyQ.isLoading ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : !historyQ.data || historyQ.data.length === 0 ? (
          <div className="text-xs text-muted-foreground py-6 text-center border border-dashed border-border rounded-lg">
            Nenhum login registrado ainda.
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            {historyQ.data.map((r, i) => (
              <div
                key={r.id}
                className={`flex items-center justify-between px-4 py-2.5 text-xs ${
                  i > 0 ? "border-t border-border" : ""
                }`}
              >
                <div className="min-w-0">
                  <div className="font-medium">
                    {new Date(r.created_at).toLocaleString("pt-BR")}
                  </div>
                  <div className="text-muted-foreground truncate max-w-md mt-0.5">
                    {r.user_agent || "Dispositivo desconhecido"}
                  </div>
                </div>
                <div className="text-muted-foreground text-[11px] shrink-0 ml-3">{r.ip || "—"}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
