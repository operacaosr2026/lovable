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
