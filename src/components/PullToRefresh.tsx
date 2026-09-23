import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { Loader2, ArrowDown } from "lucide-react";

const THRESHOLD = 70; // px (já com resistência) pra disparar
const MAX_PULL = 110;

// Algum ancestral do alvo está rolado pra baixo? Então o gesto é pra rolar ele, não pra atualizar.
function insideScrolledContainer(el: EventTarget | null): boolean {
  let node = el as HTMLElement | null;
  while (node && node !== document.body) {
    if (node.scrollTop > 0) return true;
    node = node.parentElement;
  }
  return false;
}

/**
 * Arrastar pra baixo no topo da página (touch) recarrega as queries ativas —
 * ou seja, só os dados da tela que está aberta.
 */
export function PullToRefresh() {
  const qc = useQueryClient();
  const router = useRouter();
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const startX = useRef(0);
  // null = ainda não decidiu; false = gesto horizontal (tabela/kanban), ignora até soltar
  const vertical = useRef<boolean | null>(null);
  const pullRef = useRef(0);
  const refreshingRef = useRef(false);

  useEffect(() => {
    const onStart = (e: TouchEvent) => {
      if (refreshingRef.current || e.touches.length !== 1) return;
      if (window.scrollY > 0) return;
      // Modal/sheet aberto (Radix trava o scroll do body)
      if (document.body.hasAttribute("data-scroll-locked")) return;
      if (insideScrolledContainer(e.target)) return;
      startY.current = e.touches[0].clientY;
      startX.current = e.touches[0].clientX;
      vertical.current = null;
    };

    const onMove = (e: TouchEvent) => {
      if (startY.current === null) return;
      const dy = e.touches[0].clientY - startY.current;
      const dx = e.touches[0].clientX - startX.current;
      if (vertical.current === null) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        vertical.current = Math.abs(dy) > Math.abs(dx);
      }
      if (!vertical.current) return;
      if (dy <= 0 || window.scrollY > 0) {
        if (pullRef.current !== 0) { pullRef.current = 0; setPull(0); }
        return;
      }
      if (e.cancelable) e.preventDefault();
      const d = Math.min(MAX_PULL, dy * 0.5);
      pullRef.current = d;
      setPull(d);
    };

    const onEnd = async () => {
      if (startY.current === null) return;
      startY.current = null;
      const d = pullRef.current;
      pullRef.current = 0;
      if (d < THRESHOLD) { setPull(0); return; }
      refreshingRef.current = true;
      setRefreshing(true);
      setPull(THRESHOLD);
      try {
        await Promise.all([
          qc.refetchQueries({ type: "active" }),
          router.invalidate(),
        ]);
      } finally {
        refreshingRef.current = false;
        setRefreshing(false);
        setPull(0);
      }
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [qc, router]);

  if (pull === 0 && !refreshing) return null;

  const ready = pull >= THRESHOLD;
  return (
    <div
      className="md:hidden fixed left-0 right-0 z-50 flex justify-center pointer-events-none"
      style={{
        top: 56 + pull - 40,
        transition: startY.current === null ? "top 200ms ease" : undefined,
      }}
    >
      <div className="size-9 rounded-full bg-surface border border-border shadow-md grid place-items-center text-primary">
        {refreshing ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <ArrowDown
            className="size-4 transition-transform"
            style={{ transform: `rotate(${ready ? 180 : (pull / THRESHOLD) * 180}deg)`, opacity: Math.min(1, pull / THRESHOLD) }}
          />
        )}
      </div>
    </div>
  );
}
