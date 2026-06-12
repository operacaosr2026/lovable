import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getInvitationByToken } from "@/lib/members.functions";
import { useAuth } from "@/lib/auth";
import { Sparkles } from "lucide-react";

export const Route = createFileRoute("/invite/$token")({
  component: InvitePage,
});

function InvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const { signUpWithPassword, user } = useAuth();
  const fetchInvite = useServerFn(getInvitationByToken);

  const [invite, setInvite] = useState<any>(null);
  const [loadingInvite, setLoadingInvite] = useState(true);
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    fetchInvite({ data: { token } })
      .then((r) => setInvite(r.invitation))
      .finally(() => setLoadingInvite(false));
  }, [token]);

  useEffect(() => {
    if (user && invite?.status === "accepted") navigate({ to: "/" });
  }, [user, invite, navigate]);

  if (loadingInvite) return <div className="min-h-screen grid place-items-center text-sm text-muted-foreground">Carregando convite...</div>;
  if (!invite) return <Centered title="Convite inválido" desc="Esse link não existe ou foi removido." />;
  if (invite.status !== "pending") return <Centered title="Convite indisponível" desc={`Status: ${invite.status}`} />;
  if (new Date(invite.expires_at) < new Date()) return <Centered title="Convite expirado" desc="Peça um novo ao administrador." />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { needsConfirmation } = await signUpWithPassword(invite.email, password, {
        fullName,
        inviteToken: token,
      });
      if (needsConfirmation) {
        setInfo("Confira seu email para confirmar a conta. Depois faça login.");
      } else {
        navigate({ to: "/" });
      }
    } catch (err: any) {
      setError(err?.message ?? "Erro ao criar conta");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center px-6 bg-background">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 justify-center mb-8">
          <div className="size-10 rounded-2xl gradient-primary grid place-items-center text-primary-foreground">
            <Sparkles className="size-5" />
          </div>
          <div className="text-xl font-bold tracking-tight">SRX Growth</div>
        </div>
        <div className="rounded-3xl bg-surface border border-border p-7 soft-shadow">
          <h1 className="text-xl font-bold tracking-tight text-center">Você foi convidado{invite.ownerName ? ` por ${invite.ownerName}` : ""}</h1>
          <p className="text-xs text-muted-foreground mt-1.5 text-center">
            Crie sua senha para acessar o workspace como <strong>{invite.email}</strong>.
          </p>
          <form onSubmit={submit} className="mt-5 space-y-3">
            <input
              type="text"
              placeholder="Seu nome"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full h-11 px-3.5 rounded-xl bg-background border border-border text-sm outline-none focus:border-primary"
            />
            <input
              type="password"
              placeholder="Crie uma senha (mín. 8 caracteres)"
              minLength={8}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-11 px-3.5 rounded-xl bg-background border border-border text-sm outline-none focus:border-primary"
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-medium text-sm disabled:opacity-60"
            >
              {busy ? "Criando..." : "Aceitar convite e criar conta"}
            </button>
          </form>
          {error && <p className="text-xs text-destructive mt-3 text-center">{error}</p>}
          {info && <p className="text-xs text-emerald-600 mt-3 text-center">{info}</p>}
        </div>
      </div>
    </div>
  );
}

function Centered({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="min-h-screen grid place-items-center px-6 bg-background text-center">
      <div>
        <h1 className="text-xl font-bold">{title}</h1>
        <p className="text-sm text-muted-foreground mt-2">{desc}</p>
      </div>
    </div>
  );
}
