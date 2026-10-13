import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Corpo dos e-mails mandados pelo Zoho (Atendimento e Notificações): texto
// digitado em HTML + assinatura do workspace.

// URL vira link; a de rastreio aparece como "Track your order here" (igual à resposta automática).
export function textToHtml(text: string) {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const linked = esc.replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (u) => {
    const label = /track/i.test(u) ? "Track your order here" : u;
    return `<a href="${u.replace(/"/g, "&quot;")}" style="color:#2563eb${label === u ? "" : ";font-weight:bold"}">${label}</a>`;
  });
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${linked.replace(/\r?\n/g, "<br>")}</div>`;
}

export async function senderName(userId: string) {
  const { data: prof } = await supabaseAdmin.from("profiles").select("full_name").eq("id", userId).maybeSingle();
  if (prof?.full_name?.trim()) return prof.full_name.trim();
  const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
  return data?.user?.email?.split("@")[0] ?? "";
}

// Texto digitado + assinatura do workspace ({nome} = quem está respondendo).
export async function buildBody(ownerId: string, userId: string, text: string, withSignature: boolean) {
  let html = textToHtml(text);
  if (!withSignature) return html;
  const { data: st } = await supabaseAdmin.from("support_settings").select("signature,signature_enabled").eq("owner_id", ownerId).maybeSingle();
  if (st?.signature_enabled && st.signature?.trim()) {
    const sig = st.signature.replace(/\{nome\}/gi, await senderName(userId));
    html += `<br><div style="color:#555">${textToHtml(sig)}</div>`;
  }
  return html;
}
