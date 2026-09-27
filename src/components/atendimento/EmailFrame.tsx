import { useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "isomorphic-dompurify";
import { MoreHorizontal } from "lucide-react";

// Corpo do e-mail num iframe isolado: sem scripts (sandbox), CSS do e-mail não
// vaza pra página e links abrem em nova aba. O histórico citado ("Em ... escreveu")
// fica escondido até clicar em "•••".
const QUOTE_SELECTORS = "blockquote, .gmail_quote, .zmail_extra, .yahoo_quoted, #divRplyFwdMsg, #divRplyFwdMsg ~ *, .moz-cite-prefix";
const HAS_QUOTE = /<blockquote|gmail_quote|zmail_extra|yahoo_quoted|divRplyFwdMsg|moz-cite-prefix/i;

export function EmailFrame({ html, color }: { html: string; color: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(40);
  const [showQuote, setShowQuote] = useState(false);
  const hasQuote = HAS_QUOTE.test(html);

  const srcDoc = useMemo(() => {
    const clean = DOMPurify.sanitize(html, { FORBID_TAGS: ["form", "input", "button", "textarea", "select"] });
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
  }, [html, color, showQuote]);

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
