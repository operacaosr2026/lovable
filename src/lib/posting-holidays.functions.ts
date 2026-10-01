import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Feriados do TM Postagem (Configurações → Feriados) — ver
// *_posting_holidays.sql e businessDaysBetween em logistics-kpis.ts.

export type PostingHoliday = { id: string; day: string; name: string; kind: "holiday" | "workday" };

// Feriados da China em 2026 (quem posta é o fornecedor de lá) e os sábados/
// domingos de compensação (调休). Ponto de partida pra conferir com o
// calendário oficial do Conselho de Estado — dá pra editar na tela.
const CHINA_2026: Omit<PostingHoliday, "id">[] = [
  ...["2026-01-01", "2026-01-02"].map((day) => ({ day, name: "Ano Novo", kind: "holiday" as const })),
  { day: "2026-01-04", name: "Ano Novo (compensação)", kind: "workday" },
  ...["2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20", "2026-02-23"]
    .map((day) => ({ day, name: "Ano Novo Chinês", kind: "holiday" as const })),
  { day: "2026-02-14", name: "Ano Novo Chinês (compensação)", kind: "workday" },
  { day: "2026-02-28", name: "Ano Novo Chinês (compensação)", kind: "workday" },
  { day: "2026-04-06", name: "Qingming", kind: "holiday" },
  ...["2026-05-01", "2026-05-04", "2026-05-05"].map((day) => ({ day, name: "Dia do Trabalho", kind: "holiday" as const })),
  { day: "2026-05-09", name: "Dia do Trabalho (compensação)", kind: "workday" },
  { day: "2026-06-19", name: "Barco-Dragão", kind: "holiday" },
  { day: "2026-09-25", name: "Meio do Outono", kind: "holiday" },
  ...["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07"]
    .map((day) => ({ day, name: "Golden Week", kind: "holiday" as const })),
  { day: "2026-09-20", name: "Golden Week (compensação)", kind: "workday" },
  { day: "2026-10-10", name: "Golden Week (compensação)", kind: "workday" },
];

const isMissingTable = (e: { code?: string } | null) => e?.code === "42P01" || e?.code === "PGRST205";

export const listPostingHolidays = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }): Promise<PostingHoliday[]> => {
    const { data, error } = await supabaseAdmin
      .from("posting_holidays")
      .select("id,day,name,kind")
      .eq("user_id", context.ownerId)
      .order("day", { ascending: true });
    // Migration ainda não rodada: TM Postagem segue só sem sábado/domingo.
    if (isMissingTable(error)) return [];
    if (error) throw new Error(error.message);
    return (data ?? []) as PostingHoliday[];
  });

export const addPostingHoliday = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    name: z.string().trim().max(80),
    kind: z.enum(["holiday", "workday"]),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await supabaseAdmin
      .from("posting_holidays")
      .upsert({ user_id: context.ownerId, ...data }, { onConflict: "user_id,day" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deletePostingHoliday = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await supabaseAdmin
      .from("posting_holidays").delete().eq("id", data.id).eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Carrega a lista da China 2026 sem mexer nas datas que já existem.
export const addChinaHolidays2026 = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    const { error } = await supabaseAdmin
      .from("posting_holidays")
      .upsert(CHINA_2026.map((h) => ({ user_id: context.ownerId, ...h })), { onConflict: "user_id,day", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    return { added: CHINA_2026.length };
  });
