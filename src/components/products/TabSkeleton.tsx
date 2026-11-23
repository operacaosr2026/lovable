// Esqueleto de carregamento das abas do produto (no lugar do "girando").
export function TabSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-label="Carregando">
      <div className="h-24 rounded-2xl bg-muted/60" />
      {Array.from({ length: rows }, (_, i) => <div key={i} className="h-44 rounded-2xl bg-muted/45" />)}
    </div>
  );
}
