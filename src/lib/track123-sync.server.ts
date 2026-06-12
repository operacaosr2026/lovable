import { supabaseAdmin } from "@/integrations/supabase/client.server";

const TRACK123_API_BASE = "https://api.track123.com/gateway/open-api/tk/v2.1";

export async function runTrack123Sync(shopId: string, apiKey: string, supabase: typeof supabaseAdmin) {
    // Get tracking numbers from existing tracking rows
    const { data: trackings } = await supabase.from("shop_order_tracking")
      .select("id,order_id,tracking_number,timeline").eq("shop_id", shopId)
      .not("tracking_number", "is", null).limit(50);

    const { data: rules } = await supabase.from("track123_event_rules")
      .select("event_key,event_label,target_status,enabled")
      .eq("shop_id", shopId).eq("enabled", true);

    const ruleMap = new Map<string, string>();
    for (const r of rules ?? []) {
      ruleMap.set(r.event_key.toLowerCase(), r.target_status);
      ruleMap.set(r.event_label.toLowerCase(), r.target_status);
    }
    function matchRule(text: string | null | undefined): string | null {
      if (!text) return null;
      const t = text.toLowerCase().trim();
      if (ruleMap.has(t)) return ruleMap.get(t)!;
      for (const [k, v] of ruleMap.entries()) {
        if (t.includes(k) || k.includes(t)) return v;
      }
      return null;
    }

    const numbers = (trackings ?? []).map((t) => t.tracking_number).filter((n): n is string => !!n);

    let updated = 0;
    let lastError: string | null = null;
    const byTrackNo = new Map<string, any>();

    const track123Headers = {
      "Content-Type": "application/json",
      "accept": "application/json",
      "Track123-Api-Secret": apiKey,
    };

    let importError: string | null = null;
    if (numbers.length) {
      // Best-effort registration: numbers already registered just come back as "duplicate" rejects, which is fine.
      // Small batches so a low remaining credit balance only blocks the numbers that don't fit.
      for (let i = 0; i < numbers.length; i += 25) {
        const chunk = numbers.slice(i, i + 25);
        try {
          const r = await fetch(`${TRACK123_API_BASE}/track/import`, {
            method: "POST",
            headers: track123Headers,
            body: JSON.stringify(chunk.map((n) => ({ trackNo: n }))),
          });
          const text = await r.text();
          let j: any;
          try { j = JSON.parse(text); } catch { continue; }
          if (j?.code && j.code !== "00000") {
            importError = `Registro (${j.code}): ${j.msg ?? text.slice(0, 200)}`;
            if (j.code === "101107") break; // out of credit — further chunks will fail too
          }
        } catch {/* ignore — querying below will surface real errors */}
      }

      for (let i = 0; i < numbers.length; i += 100) {
        const chunk = numbers.slice(i, i + 100);
        try {
          const r = await fetch(`${TRACK123_API_BASE}/track/query`, {
            method: "POST",
            headers: track123Headers,
            body: JSON.stringify({ trackNoInfos: chunk.map((trackNo) => ({ trackNo })), queryPageSize: 100 }),
          });
          const text = await r.text();
          if (!r.ok) { lastError = `Falha (${r.status}): ${text.slice(0, 200)}`; continue; }
          let j: any;
          try { j = JSON.parse(text); } catch { lastError = `Resposta inválida: ${text.slice(0, 200)}`; continue; }
          if (j?.code && j.code !== "00000" && !j?.data) { lastError = `${j.code}: ${j.msg ?? text.slice(0, 200)}`; continue; }

          const content = j?.data?.accepted?.content ?? j?.data?.list ?? j?.data?.content ?? [];
          for (const item of content) {
            if (item?.trackNo) byTrackNo.set(item.trackNo, item);
          }
          const rejected = j?.data?.rejected?.content ?? j?.data?.rejected ?? [];
          for (const rej of rejected) {
            const reason = rej.error?.msg ?? rej.msg ?? rej.message ?? "rejeitado";
            lastError = `${rej.trackNo ?? "?"}: ${reason}`.slice(0, 200);
          }
        } catch (e: any) {
          lastError = String(e?.message ?? e).slice(0, 500);
        }
      }
    }

    for (const t of trackings ?? []) {
      if (!t.tracking_number) continue;
      const item = byTrackNo.get(t.tracking_number);
      if (!item) { lastError = lastError ?? `Sem dados para ${t.tracking_number}`; continue; }

      const logistics = item.localLogisticsInfo ?? item;
      const events = logistics.trackingDetails ?? [];
      const last = events[0] ?? null;
      const lastLabel: string | null = last?.eventDetail ?? null;
      const lastAt: string | null = last?.eventTime ?? last?.eventTimeZeroUTC ?? null;

      const update: any = {
        carrier: logistics.courierCode ?? null,
        tracking_status: item.transitStatus ?? null,
        last_event_at: lastAt,
        last_event_label: lastLabel,
        timeline: events.length ? events : t.timeline,
      };

      const target = matchRule(lastLabel) ?? matchRule(item.transitStatus) ?? matchRule(item.transitSubStatus);
      const nowDate = new Date().toISOString().slice(0, 10);
      const orderUpdate: { payment_status?: string; shipped_at?: string; delivered_at?: string; problem_at?: string } = {};
      if (target === "shipped") {
        update.shipped_at = new Date().toISOString();
        orderUpdate.payment_status = "shipped";
        orderUpdate.shipped_at = nowDate;
      } else if (target === "delivered") {
        update.delivered_at = new Date().toISOString();
        orderUpdate.delivered_at = nowDate;
        orderUpdate.payment_status = "shipped";
      } else if (target === "problem") {
        update.problem_at = new Date().toISOString();
        orderUpdate.problem_at = nowDate;
      }

      await supabase.from("shop_order_tracking").update(update).eq("id", t.id);
      if (Object.keys(orderUpdate).length) {
        await supabase.from("shop_orders").update(orderUpdate).eq("id", t.order_id);
      }
      updated++;
    }

    const total = trackings?.length ?? 0;
    let status: string;
    let errorMsg: string | null;
    if (total === 0) {
      status = "ok";
      errorMsg = "Nenhum pedido com código de rastreio para sincronizar.";
    } else if (updated === 0) {
      status = "error";
      errorMsg = importError ?? lastError ?? "Falha ao sincronizar rastreios.";
    } else {
      status = "ok";
      const err = importError ?? lastError;
      errorMsg = err ? `${updated}/${total} sincronizados. Último erro: ${err}` : null;
    }

    await supabaseAdmin.from("track123_integrations")
      .update({ last_sync_at: new Date().toISOString(), last_sync_status: status, last_sync_error: errorMsg })
      .eq("shop_id", shopId);

    return { updated, total, status, errorMsg };
}
