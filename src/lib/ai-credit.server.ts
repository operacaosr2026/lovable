import Anthropic from "@anthropic-ai/sdk";
import { reportSystemErrorAll, clearSystemErrorAll } from "@/lib/system-errors.server";

// Saldo da IA (Anthropic): a API não informa quanto crédito sobra, então o aviso
// sai na hora em que uma chamada falha por falta de saldo — aviso no sino
// "IA sem saldo" pra todos os donos (a chave é uma só). Some sozinho quando
// uma chamada volta a funcionar. Toda chamada à IA passa por withAiCredit.

const KEY = "ai_credit";
const TITLE = "IA sem saldo — adicionar créditos na Anthropic";
const BILLING_URL = "https://console.anthropic.com/settings/billing";

// 402 billing_error; contas antigas recebiam 400 "credit balance is too low".
// Pelos campos do erro da SDK (status/type), não só por instanceof: com duas
// cópias da SDK carregadas (ESM/CJS) o instanceof falha.
export function isAiCreditError(e: unknown): boolean {
  const err = e as { status?: unknown; type?: unknown; message?: unknown } | null;
  if (!(e instanceof Anthropic.APIError) && typeof err?.status !== "number") return false;
  if (err!.status === 402 || err!.type === "billing_error") return true;
  return err!.status === 400 && /credit balance/i.test(String(err!.message ?? ""));
}

// Sucesso limpa o aviso no máximo a cada 10 min por instância — não dá pra
// consultar o banco a cada e-mail classificado.
let lastClearAt = 0;
let creditAlertRaised = false;

export async function withAiCredit<T>(fn: () => Promise<T>): Promise<T> {
  try {
    const r = await fn();
    if (creditAlertRaised || Date.now() - lastClearAt > 10 * 60_000) {
      lastClearAt = Date.now();
      creditAlertRaised = false;
      await clearSystemErrorAll(KEY);
    }
    return r;
  } catch (e) {
    if (isAiCreditError(e)) {
      creditAlertRaised = true;
      await reportSystemErrorAll(KEY, TITLE,
        `As funções de IA (tags e tradução do Atendimento, defesa de chargeback, Inteligência) pararam. Adicione saldo em ${BILLING_URL}`);
      // Na tela, mensagem clara em vez do JSON da Anthropic.
      throw new Error(`A IA está sem saldo na Anthropic. Adicione créditos em ${BILLING_URL.replace("https://", "")} e tente de novo.`);
    }
    throw e;
  }
}
