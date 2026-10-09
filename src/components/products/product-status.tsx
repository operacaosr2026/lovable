import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listProductBoardColumns } from "@/lib/product-board.functions";
import { columnTone } from "@/components/shops/StoreBoard";

export const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(isFinite(n) ? n : 0);

export type ProductStatus = { id: string; name: string; position: number; color: string | null };

// Status do produto = colunas da esteira (editáveis na própria esteira).
export function useProductStatuses() {
  const fn = useServerFn(listProductBoardColumns);
  const { data } = useQuery({ queryKey: ["product-board-columns"], queryFn: () => fn() });
  const statuses = (data ?? []) as ProductStatus[];
  return { statuses, byId: new Map(statuses.map((s) => [s.id, s])) };
}

export function StatusBadge({ status, className = "" }: { status: ProductStatus | undefined; className?: string }) {
  if (!status) return null;
  const tone = columnTone(status.name, status.color);
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md font-medium bg-muted/70 text-foreground/80 max-w-full ${className}`}>
      <span className={`size-1.5 rounded-full shrink-0 ${tone.dot}`} />
      <span className="truncate">{status.name}</span>
    </span>
  );
}
