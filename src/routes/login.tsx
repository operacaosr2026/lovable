import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { Sparkles } from "lucide-react";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined as string | undefined,
  }),
  head: () => ({
    meta: [
      { title: "Entrar — SRX Growth" },
      { name: "description", content: "Acesse seu SRX Growth." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { user, loading, signInWithPassword } = useAuth();
  const navigate = useNavigate();
  const { redirect: redirectTo } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) {
      const dest = redirectTo && !redirectTo.startsWith("/login") ? redirectTo : "/";
      navigate({ to: dest });
    }
  }, [loading, user, navigate, redirectTo]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signInWithPassword(email, password);
    } catch (err: any) {
      setError(err?.message ?? "Email ou senha incorretos.");
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
          <h1 className="text-xl font-bold tracking-tight text-center">Bem-vindo de volta</h1>
          <p className="text-xs text-muted-foreground mt-1.5 text-center">Entre com seu email e senha.</p>

          <form onSubmit={handleSubmit} className="mt-5 space-y-3">
            <input
              type="email"
              placeholder="email@exemplo.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full h-11 px-3.5 rounded-xl bg-background border border-border text-sm outline-none focus:border-primary"
            />
            <input
              type="password"
              placeholder="Senha"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-11 px-3.5 rounded-xl bg-background border border-border text-sm outline-none focus:border-primary"
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 disabled:opacity-60"
            >
              {busy ? "Aguarde..." : "Entrar"}
            </button>
          </form>

          {error && <p className="text-xs text-destructive mt-3 text-center">{error}</p>}
        </div>
      </div>
    </div>
  );
}
