// O PostgREST do Supabase devolve no máximo 1.000 linhas por requisição e
// corta o resto SEM erro — somar pedidos/lançamentos de um período maior que
// isso dava faturamento, lucro e custo menores que o real, calados. Pagina a
// própria consulta até esgotar, devolvendo o mesmo formato { data, error } de
// um `await` normal pra ser trocado sem mexer no código em volta.
//
// Uso: `await selectAll(supabase.from("x").select("...").eq(...))` — sem
// .single()/.maybeSingle()/.limit()/.range() na consulta.
const PAGE_SIZE = 1000;

export async function selectAll<T = any>(
  query: any,
): Promise<{ data: T[]; error: { message: string } | null }> {
  // Paginar sem ORDER BY estável pode repetir/pular linhas entre páginas; `id`
  // entra como desempate depois de qualquer ordenação já pedida.
  query.order("id", { ascending: true });
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
    if (error) return { data: out, error };
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) return { data: out, error: null };
  }
}

// Filtro .in() com muitos valores vira uma URL enorme, e o gateway do Supabase
// recusa a partir de ~400 UUIDs ("Bad Request") — medido em 24/09/2026. O erro
// costumava ser ignorado, então a tela ficava sem os dados calada (ex.: aba
// Rastreamento sem o rastreio real quando o período passa de ~400 pedidos).
export const IN_CHUNK_SIZE = 200;

export function chunk<T>(values: T[], size = IN_CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

// Como selectAll, mas divide `values` em lotes e monta uma consulta por lote.
export async function selectAllIn<T = any, V = string>(
  values: V[],
  build: (chunkValues: V[]) => any,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const out: T[] = [];
  for (const c of chunk(values)) {
    const { data, error } = await selectAll<T>(build(c));
    if (error) return { data: out, error };
    out.push(...data);
  }
  return { data: out, error: null };
}
