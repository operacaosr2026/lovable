import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { selectAll } from "@/lib/select-all";
import { eventTextKey, rawEvents, sanitizeEvents } from "@/lib/tracking-display";
import { autoPhase, PHASE_KEYS, type Phase } from "@/lib/tracking-phases";

// Configurações › Rastreamento › Textos: cada texto que veio da transportadora
// nos rastreios dos últimos 180 dias, o que o cliente vê hoje pelas regras e o
// texto trocado na mão (tracking_text_overrides). Também a fase de cada texto
// (tracking-phases.ts) — texto sem regra aparece como erro pra escolher a fase
// (tracking_phase_overrides), que a conta do Gerencial › Transportadoras usa.

const isMissingTable = (e: { code?: string } | null) => e?.code === "42P01" || e?.code === "PGRST205";
const WINDOW_DAYS = 180; // mesma janela do acompanhamento (e da conta das transportadoras)

export type TrackingTextRow = {
  key: string;
  example: string;          // texto como veio (um exemplo)
  location: string | null;  // local de um exemplo
  count: number;            // eventos nos últimos 180 dias
  rule: string | null;      // o que as regras mostram (null = some)
  generic: boolean;         // virou "em trânsito" (escondido)
  override: string | null;  // texto trocado na mão
  phaseAuto: Phase | null;  // fase pelas regras (null = sem regra)
  phaseOverride: Phase | null; // fase escolhida na mão
};

export const listTrackingTexts = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }): Promise<TrackingTextRow[]> => {
    const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
    const [tracking, ov, ph] = await Promise.all([
      selectAll(supabaseAdmin.from("shop_order_tracking").select("id,timeline,extra_packages")
        .eq("user_id", context.ownerId).gte("updated_at", since)),
      supabaseAdmin.from("tracking_text_overrides").select("text_key,example_text,display_text").eq("user_id", context.ownerId),
      supabaseAdmin.from("tracking_phase_overrides").select("text_key,example_text,phase").eq("user_id", context.ownerId),
    ]);
    if (ph.error && !isMissingTable(ph.error)) throw new Error(ph.error.message);
    if (tracking.error) throw new Error(tracking.error.message);
    if (ov.error && !isMissingTable(ov.error)) throw new Error(ov.error.message);

    const rows = new Map<string, TrackingTextRow>();
    const add = (timeline: any[] | null | undefined) => {
      for (const e of rawEvents(timeline)) {
        if (!e.description) continue;
        const key = eventTextKey(e.description);
        if (!key) continue;
        const r = rows.get(key);
        if (r) { r.count++; if (!r.location && e.location) r.location = e.location; continue; }
        const shown = sanitizeEvents([{ ...e, at: null }])[0];
        rows.set(key, {
          key, example: e.description, location: e.location, count: 1,
          rule: shown?.description ?? null, generic: !!shown?.generic, override: null,
          phaseAuto: autoPhase(e.description), phaseOverride: null,
        });
      }
    };
    for (const t of tracking.data as any[]) {
      add(t.timeline);
      for (const p of (t.extra_packages ?? []) as any[]) add(p?.timeline);
    }
    // Troca salva de texto que não apareceu nos últimos 180 dias continua na lista.
    for (const o of (ov.data ?? []) as any[]) {
      const r = rows.get(o.text_key);
      if (r) r.override = o.display_text;
      else rows.set(o.text_key, { key: o.text_key, example: o.example_text || o.text_key, location: null, count: 0, rule: null, generic: false, override: o.display_text, phaseAuto: autoPhase(o.example_text || o.text_key), phaseOverride: null });
    }
    for (const o of (ph.data ?? []) as any[]) {
      const r = rows.get(o.text_key);
      if (r) r.phaseOverride = o.phase;
      else rows.set(o.text_key, { key: o.text_key, example: o.example_text || o.text_key, location: null, count: 0, rule: null, generic: false, override: null, phaseAuto: autoPhase(o.example_text || o.text_key), phaseOverride: o.phase });
    }
    return [...rows.values()].sort((a, b) => b.count - a.count);
  });

// Salva o texto trocado (vazio = volta pra regra).
export const saveTrackingTextOverride = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    example: z.string().trim().min(1).max(2000),
    text: z.string().trim().max(300),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const key = eventTextKey(data.example);
    if (!key) throw new Error("Texto inválido");
    const q = supabaseAdmin.from("tracking_text_overrides");
    const { error } = data.text
      ? await q.upsert({ user_id: context.ownerId, text_key: key, example_text: data.example.slice(0, 500), display_text: data.text, updated_at: new Date().toISOString() }, { onConflict: "user_id,text_key" })
      : await q.delete().eq("user_id", context.ownerId).eq("text_key", key);
    if (error) throw new Error(isMissingTable(error) ? "Tabela de textos ainda não criada no banco" : error.message);
    return { ok: true };
  });

// Salva a fase do texto (null = volta pra regra).
export const saveTrackingPhase = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    example: z.string().trim().min(1).max(2000),
    phase: z.enum(PHASE_KEYS).nullable(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const key = eventTextKey(data.example);
    if (!key) throw new Error("Texto inválido");
    const q = supabaseAdmin.from("tracking_phase_overrides");
    const { error } = data.phase
      ? await q.upsert({ user_id: context.ownerId, text_key: key, example_text: data.example.slice(0, 500), phase: data.phase, updated_at: new Date().toISOString() }, { onConflict: "user_id,text_key" })
      : await q.delete().eq("user_id", context.ownerId).eq("text_key", key);
    if (error) throw new Error(isMissingTable(error) ? "Tabela de fases ainda não criada no banco" : error.message);
    return { ok: true };
  });
