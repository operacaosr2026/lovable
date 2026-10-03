import { useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "isomorphic-dompurify";
import { MoreHorizontal } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

// Corpo do e-mail num iframe isolado: sem scripts (sandbox), CSS do e-mail não
// vaza pra página e links abrem em nova aba. O histórico citado ("Em ... escreveu")
// fica escondido até clicar em "•••".
const QUOTE_SELECTORS = "blockquote, .gmail_quote, .zmail_extra, .yahoo_quoted, #divRplyFwdMsg, #divRplyFwdMsg ~ *, .moz-cite-prefix";
const HAS_QUOTE = /<blockquote|gmail_quote|zmail_extra|yahoo_quoted|divRplyFwdMsg|moz-cite-prefix/i;

// Onde começa o e-mail anterior citado num texto (tradução em português):
// "Em 29 de set…, Fulano <x> escreveu:", "On Tue… wrote:", "---- Em ter.… escreveu ----",
// "-----Original Message-----", "De: …", linhas com ">".
const QUOTE_START = [
  /^[-\s]*(Em|On|Na|No|El|Le|Am)\b[^\n]{0,220}\n?[^\n]{0,120}\b(escreveu|wrote|escribió|a écrit|schrieb)\b[\s:-]*$/im,
  /^-{2,}\s*(Original Message|Mensagem original|Forwarded message|Mensagem encaminhada)/im,
  /^(From|De):\s.+$/im,
  /^>/m,
];
export function splitQuoted(text: string): { body: string; quoted: string | null } {
  const idx = Math.min(...QUOTE_START.map((re) => text.search(re)).filter((i) => i > 0));
  if (!Number.isFinite(idx)) return { body: text, quoted: null };
  return { body: text.slice(0, idx).replace(/\s+$/, ""), quoted: text.slice(idx) };
}

// Texto (tradução) com o e-mail anterior citado recolhido; o botão "…" mostra.
export function QuotedText({ text }: { text: string }) {
  const [showQuote, setShowQuote] = useState(false);
  const { body, quoted } = useMemo(() => splitQuoted(text), [text]);
  return (
    <div>
      <p className="text-sm whitespace-pre-wrap leading-relaxed">{body}</p>
      {quoted && (
        <>
          <button
            type="button"
            onClick={() => setShowQuote((v) => !v)}
            title={showQuote ? "Esconder histórico" : "Mostrar histórico"}
            className="mt-1 h-5 px-2 rounded-md bg-foreground/5 hover:bg-foreground/10 text-muted-foreground grid place-items-center"
          >
            <MoreHorizontal className="size-3.5" />
          </button>
          {showQuote && <p className="mt-2 text-sm whitespace-pre-wrap leading-relaxed text-muted-foreground">{quoted}</p>}
        </>
      )}
    </div>
  );
}

// Imagens coladas no corpo (inline): o Zoho manda "/mail/ImageDisplay?...&cid=X",
// que só abre logado no Zoho. Busca cada uma em /api/atendimento/inline (com o
// token da sessão) e devolve cid → endereço local (blob) pra mostrar.
const INLINE_SRC = /src="(\/mail\/ImageDisplay\?[^"]*)"/g;
const param = (src: string, k: string) => new URLSearchParams(src.replace(/&amp;/g, "&").split("?")[1] ?? "").get(k) ?? "";
export function inlineImageRefs(html: string | null | undefined) {
  return [...(html ?? "").matchAll(INLINE_SRC)].map((m) => ({ src: m[1], cid: param(m[1], "cid"), name: param(m[1], "f") })).filter((r) => r.cid);
}
export function useInlineImages(messageId: string | null | undefined, html: string | null | undefined) {
  const refs = useMemo(() => inlineImageRefs(html), [html]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!messageId || !refs.length) return;
    let alive = true;
    const made: string[] = [];
    (async () => {
      const { data } = await supabase.auth.getSession();
      const out: Record<string, string> = {};
      await Promise.all(refs.map(async (r) => {
        try {
          const res = await fetch(`/api/atendimento/inline?message=${messageId}&cid=${encodeURIComponent(r.cid)}&f=${encodeURIComponent(r.name)}`, {
            headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` },
          });
          if (!res.ok) return;
          const u = URL.createObjectURL(await res.blob());
          made.push(u);
          out[r.cid] = u;
        } catch { /* fica sem a imagem */ }
      }));
      if (alive) setUrls(out);
    })();
    return () => { alive = false; made.forEach((u) => URL.revokeObjectURL(u)); };
  }, [messageId, refs]);
  return urls;
}

// Na tradução (texto puro) as imagens do corpo aparecem embaixo.
export function InlineImages({ urls }: { urls: Record<string, string> }) {
  const list = Object.values(urls);
  if (!list.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {list.map((u) => (
        <a key={u} href={u} target="_blank" rel="noreferrer">
          <img src={u} alt="" className="max-h-64 max-w-full rounded-lg border border-border" />
        </a>
      ))}
    </div>
  );
}

export function EmailFrame({ html, color, images = {} }: { html: string; color: string; images?: Record<string, string> }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(40);
  const [showQuote, setShowQuote] = useState(false);
  const hasQuote = HAS_QUOTE.test(html);

  const srcDoc = useMemo(() => {
    const clean = DOMPurify.sanitize(html, { FORBID_TAGS: ["form", "input", "button", "textarea", "select"] })
      .replace(INLINE_SRC, (all, src) => { const u = images[param(src, "cid")]; return u ? `src="${u}"` : all; });
    return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">
<style>
html,body{margin:0;padding:0;background:transparent}
body{font:14px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;color:${color};overflow-wrap:anywhere}
img{max-width:100%;height:auto}
table{max-width:100%}
p{margin:0 0 .6em}
a{color:#7c6af7}
${showQuote ? "" : `${QUOTE_SELECTORS}{display:none!important}`}
</style></head><body>${clean}</body></html>`;
  }, [html, color, showQuote, images]);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let ro: ResizeObserver | null = null;
    const measure = () => {
      const doc = frame.contentDocument;
      if (doc?.body) setHeight(Math.max(20, doc.documentElement.scrollHeight));
    };
    const onLoad = () => {
      measure();
      const body = frame.contentDocument?.body;
      if (body && typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(measure);
        ro.observe(body);
      }
    };
    frame.addEventListener("load", onLoad);
    return () => { frame.removeEventListener("load", onLoad); ro?.disconnect(); };
  }, [srcDoc]);

  return (
    <div>
      <iframe
        ref={ref}
        title="E-mail"
        srcDoc={srcDoc}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        className="w-full block border-0 bg-transparent"
        style={{ height }}
      />
      {hasQuote && (
        <button
          type="button"
          onClick={() => setShowQuote((v) => !v)}
          title={showQuote ? "Esconder histórico" : "Mostrar histórico"}
          className="mt-1 h-5 px-2 rounded-md bg-foreground/5 hover:bg-foreground/10 text-muted-foreground grid place-items-center"
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      )}
    </div>
  );
}
