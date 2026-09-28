import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, ExternalLink, Loader2, Plug, RefreshCw, Unplug } from "lucide-react";
import { startZohoOAuth, disconnectZoho } from "@/lib/atendimento.functions";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useSupportFn } from "./demo";

// Conectar a conta do Zoho Mail (só admin). O Client ID/Secret vêm de um app
// "Server-based" criado no api-console.zoho.com; o login abre numa janela e ela
// avisa esta página quando termina (postMessage "zoho-oauth").
export function ConnectZoho({ redirectUri, connectedEmail, onDone }: {
  redirectUri: string; connectedEmail?: string | null; onDone: () => void;
}) {
  const startFn = useSupportFn(startZohoOAuth, "startZohoOAuth");
  const disconnectFn = useSupportFn(disconnectZoho, "disconnectZoho");
  const confirm = useConfirm();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(!connectedEmail);
  useEffect(() => { setShowForm(!connectedEmail); }, [connectedEmail]);
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.type !== "zoho-oauth") return;
      setBusy(false);
      if (e.data.ok) { toast.success("Zoho conectado"); onDone(); }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [onDone]);

  const connect = async () => {
    if (!clientId.trim() || !clientSecret.trim()) return toast.error("Preencha o Client ID e o Client Secret");
    setBusy(true);
    try {
      const { url } = await startFn({ data: { client_id: clientId.trim(), client_secret: clientSecret.trim() } });
      const w = window.open(url, "zoho-oauth", "width=560,height=720");
      if (!w) window.location.href = url;
    } catch (e: any) {
      setBusy(false);
      toast.error(e.message ?? "Erro ao iniciar conexão");
    }
  };

  const disconnect = async () => {
    if (!(await confirm({ title: "Desconectar o Zoho?", description: "O Atendimento para de receber e enviar e-mails até conectar de novo, e as conversas (com status, tags e notas) saem do sistema. Nada é apagado no Zoho.", confirmText: "Desconectar", variant: "destructive" }))) return;
    await disconnectFn();
    toast.success("Zoho desconectado");
    onDone();
  };

  const copy = (v: string) => { navigator.clipboard.writeText(v); toast.success("Copiado"); };

  return (
    <div className="space-y-5">
      {connectedEmail && (
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setShowForm((v) => !v)} className="h-9 px-3.5 rounded-lg border border-border text-xs font-medium flex items-center gap-1.5 hover:bg-muted">
            <RefreshCw className="size-3.5" /> {showForm ? "Cancelar troca" : "Trocar conta / reconectar"}
          </button>
          <button onClick={disconnect} className="h-9 px-3.5 rounded-lg border border-border text-xs font-medium flex items-center gap-1.5 text-destructive hover:bg-destructive/10">
            <Unplug className="size-3.5" /> Desconectar
          </button>
        </div>
      )}

      {showForm && (
      <>

      <ol className="space-y-3 text-sm">
        <li className="flex gap-3">
          <span className="size-6 rounded-full bg-primary/10 text-primary text-xs font-semibold grid place-items-center shrink-0">1</span>
          <div>
            Abra o{" "}
            <a href="https://api-console.zoho.com/" target="_blank" rel="noreferrer" className="text-primary font-medium inline-flex items-center gap-1 hover:underline">
              Zoho API Console <ExternalLink className="size-3" />
            </a>
            {" "}(entre com a conta do e-mail de atendimento) → <b>Add Client</b> → <b>Server-based Applications</b>.
          </div>
        </li>
        <li className="flex gap-3">
          <span className="size-6 rounded-full bg-primary/10 text-primary text-xs font-semibold grid place-items-center shrink-0">2</span>
          <div className="min-w-0 flex-1 space-y-2">
            <p>Preencha e clique em <b>Create</b>:</p>
            <CopyRow label="Client Name" value="SRX Atendimento" onCopy={copy} />
            <CopyRow label="Homepage URL" value={origin} onCopy={copy} />
            <CopyRow label="Authorized Redirect URIs" value={redirectUri} onCopy={copy} />
          </div>
        </li>
        <li className="flex gap-3">
          <span className="size-6 rounded-full bg-primary/10 text-primary text-xs font-semibold grid place-items-center shrink-0">3</span>
          <div className="min-w-0 flex-1 space-y-2">
            <p>Copie o <b>Client ID</b> e o <b>Client Secret</b> (aba Client Secret) e cole aqui:</p>
            <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Client ID"
              className="w-full h-10 px-3.5 rounded-xl bg-background border border-border text-sm outline-none focus:border-primary" />
            <input value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="Client Secret" type="password" autoComplete="off"
              className="w-full h-10 px-3.5 rounded-xl bg-background border border-border text-sm outline-none focus:border-primary" />
          </div>
        </li>
      </ol>

      <button onClick={connect} disabled={busy}
        className="w-full h-10 rounded-xl bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />}
        {busy ? "Aguardando login no Zoho…" : "Conectar Zoho Mail"}
      </button>
      <p className="text-[11px] text-muted-foreground text-center">
        Vai abrir uma janela do Zoho pedindo para autorizar leitura e envio de e-mails. Os últimos 30 dias são importados na hora.
      </p>
      </>
      )}
    </div>
  );
}

function CopyRow({ label, value, onCopy }: { label: string; value: string; onCopy: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 pl-3 pr-1 py-1">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-xs font-mono truncate">{value}</p>
      </div>
      <button type="button" onClick={() => onCopy(value)} title="Copiar" className="size-7 rounded-md grid place-items-center text-muted-foreground hover:text-foreground hover:bg-background">
        <Copy className="size-3.5" />
      </button>
    </div>
  );
}
