// Número da GOFO (waybill "GFUS…") pelo nosso código — a GOFO faz a última milha
// de JCEX, SHJX e Transfly e o 17track não manda o número dela. Usa o mesmo
// endereço público da página de rastreio do site (gofo.com/us/track), sem login
// e sem custo, até 100 códigos por chamada. Não é API oficial: se mudar, o sync
// só registra o erro e segue (o rastreio continua vindo pelo 17track).

const GOFO_TRACK_API = "https://www.gofo.com/us/cnee-api/consignee/track/query/page";
const BATCH = 100;

export async function fetchGofoWaybills(numbers: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const list = [...new Set(numbers.map((n) => n.trim().toUpperCase()).filter(Boolean))];
  for (let i = 0; i < list.length; i += BATCH) {
    const res = await fetch(GOFO_TRACK_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", lang: "en", "User-Time-Zone": "America/New_York" },
      body: JSON.stringify({ numberList: list.slice(i, i + BATCH) }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`GOFO HTTP ${res.status}`);
    const body: any = await res.json();
    if (body?.code !== 200) throw new Error(`GOFO: ${String(body?.msg ?? body?.failReason ?? "resposta inesperada").slice(0, 120)}`);
    for (const r of body?.data?.success ?? []) {
      const own = String(r?.trackingNumber ?? "").trim().toUpperCase();
      const waybill = String(r?.waybillNo ?? "").trim().toUpperCase();
      if (own && waybill && waybill !== own) out.set(own, waybill);
    }
  }
  return out;
}
