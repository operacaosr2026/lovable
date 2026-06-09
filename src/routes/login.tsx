import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { Sparkles } from "lucide-react";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Entrar — Orbit" },
      { name: "description", content: "Acesse seu Orbit." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { user, loading, signInWithGoogle, signInWithPassword, signUpWithPassword } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) {
      let dest = "/";
      try {
        const stored = sessionStorage.getItem("redirectAfterLogin");
        if (stored && !stored.startsWith("/login")) {
          dest = stored;
          sessionStorage.removeItem("redirectAfterLogin");
        }
      } catch {}
      navigate({ to: dest });
    }
  }, [loading, user, navigate]);

  const handleGoogle = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (e: any) {
      setError(e?.message ?? "Não foi possível entrar.");
      setBusy(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === "signin") {
        await signInWithPassword(email, password);
      } else {
        const { needsConfirmation } = await signUpWithPassword(email, password, { fullName });
        if (needsConfirmation) {
          setInfo("Confira seu email para confirmar a conta.");
        }
      }
    } catch (err: any) {
      setError(err?.message ?? "Erro ao autenticar.");
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
          <div className="text-xl font-bold tracking-tight">Orbit</div>
        </div>

        <div className="rounded-3xl bg-surface border border-border p-7 soft-shadow">
          <h1 className="text-xl font-bold tracking-tight text-center">
            {mode === "signin" ? "Bem-vindo de volta" : "Criar conta"}
          </h1>
          <p className="text-xs text-muted-foreground mt-1.5 text-center">
            {mode === "signin" ? "Entre com email e senha ou Google." : "Cadastre-se com email e senha."}
          </p>

          <form onSubmit={handleSubmit} className="mt-5 space-y-3">
            {mode === "signup" && (
              <input
                type="text"
                placeholder="Seu nome"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full h-11 px-3.5 rounded-xl bg-background border border-border text-sm outline-none focus:border-primary"
              />
            )}
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
              {busy ? "Aguarde..." : mode === "signin" ? "Entrar" : "Criar conta"}
            </button>
          </form>

          <div className="my-4 flex items-center gap-3 text-[10px] uppercase tracking-wider text-muted-foreground">
            <div className="flex-1 h-px bg-border" /> ou <div className="flex-1 h-px bg-border" />
          </div>

          <button
            onClick={handleGoogle}
            disabled={busy || loading}
            className="w-full h-11 rounded-xl border border-border bg-background font-medium text-sm flex items-center justify-center gap-2.5 hover:bg-surface-hover disabled:opacity-60"
          >
            <GoogleIcon /> Google
          </button>

          {error && <p className="text-xs text-destructive mt-3 text-center">{error}</p>}
          {info && <p className="text-xs text-emerald-600 mt-3 text-center">{info}</p>}

          <button
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError(null);
              setInfo(null);
            }}
            className="w-full mt-4 text-xs text-muted-foreground hover:text-foreground"
          >
            {mode === "signin" ? "Não tem conta? Criar uma" : "Já tem conta? Entrar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35.5 24 35.5c-6.4 0-11.5-5.2-11.5-11.5S17.6 12.5 24 12.5c2.9 0 5.6 1.1 7.6 2.9l5.7-5.7C33.6 6.1 29.1 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.4-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.6 19 12.5 24 12.5c2.9 0 5.6 1.1 7.6 2.9l5.7-5.7C33.6 6.1 29.1 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5 0 9.6-1.9 13-5.1l-6-5.1C29.1 35.4 26.7 36 24 36c-5.3 0-9.7-3.1-11.3-7.5l-6.5 5C9.5 39.7 16.2 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4-4 5.3l6 5.1c-.4.4 6.7-4.9 6.7-14.4 0-1.2-.1-2.4-.4-3.5z"/>
    </svg>
  );
}
