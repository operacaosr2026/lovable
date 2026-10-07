import { useState, type FormEvent } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { findPublicOrder, TOO_MANY_ATTEMPTS } from "@/lib/public-tracking.functions";
import { TrackingShell } from "@/components/tracking/TrackingPageView";

// Busca pública de rastreio: número do pedido + e-mail/telefone, ou código de
// rastreio — igual à página de rastreio da loja. Liberada no AuthGate (__root.tsx).
export const Route = createFileRoute("/track/")({
  head: () => ({ meta: [{ title: "Track Your Order" }, { name: "robots", content: "noindex" }],
    links: [{ rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;700&display=swap" }] }),
  component: TrackSearch,
});

const input = "w-full h-12 rounded-lg border border-zinc-900 px-4 text-base outline-none focus:ring-2 focus:ring-zinc-900/20";
const button = "h-12 px-11 rounded-md bg-zinc-900 text-white font-bold text-lg disabled:opacity-60 inline-flex items-center gap-2";

function TrackSearch() {
  const navigate = useNavigate();
  const findFn = useServerFn(findPublicOrder);
  const [orderNumber, setOrderNumber] = useState("");
  const [contact, setContact] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function byOrder(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!orderNumber.trim() || !contact.trim()) return setMsg("Please enter your order number and email or phone number.");
    setBusy(true);
    try {
      const r = await findFn({ data: { orderNumber, contact } });
      if (!r.found) setMsg("We couldn't find an order with these details. Please check and try again.");
      else if (!r.trackingCode) setMsg(`Order ${r.orderNumber} is being prepared. You'll receive a tracking number by email as soon as it ships.`);
      else navigate({ to: "/track/$code", params: { code: r.trackingCode } });
    } catch (err: any) {
      setMsg(String(err?.message ?? "").includes(TOO_MANY_ATTEMPTS) ? TOO_MANY_ATTEMPTS : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function byCode(e: FormEvent) {
    e.preventDefault();
    const c = code.trim().replace(/\s+/g, "");
    if (c.length < 5) return setMsg("Please enter a valid tracking number.");
    navigate({ to: "/track/$code", params: { code: c } });
  }

  return (
    <TrackingShell>
      <h1 className="text-center text-4xl sm:text-5xl font-light tracking-tight mb-12">Track Your Order</h1>
      <div className="mx-auto max-w-5xl rounded-xl border border-zinc-300 px-6 sm:px-16 py-10 sm:py-14">
        <div className="grid md:grid-cols-[1fr_auto_1fr] gap-10 md:gap-12 items-start">
          <form onSubmit={byOrder} className="space-y-5">
            <label className="block space-y-2">
              <span className="text-lg">Order Number</span>
              <input className={input} value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} />
            </label>
            <label className="block space-y-2">
              <span className="text-lg">Email or Phone Number</span>
              <input className={input} value={contact} onChange={(e) => setContact(e.target.value)} />
            </label>
            <button className={button} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />}Track</button>
          </form>

          <div className="hidden md:flex flex-col items-center self-stretch gap-3 text-zinc-300">
            <span className="flex-1 border-l border-zinc-300" />
            <span className="text-sm">OR</span>
            <span className="flex-1 border-l border-zinc-300" />
          </div>
          <p className="md:hidden text-center text-sm text-zinc-400">OR</p>

          <form onSubmit={byCode} className="space-y-5">
            <label className="block space-y-2">
              <span className="text-lg">Tracking Number</span>
              <input className={input} value={code} onChange={(e) => setCode(e.target.value)} />
            </label>
            <button className={button}>Track</button>
          </form>
        </div>
        {msg && <p className="mt-8 text-center text-zinc-600">{msg}</p>}
      </div>
    </TrackingShell>
  );
}
