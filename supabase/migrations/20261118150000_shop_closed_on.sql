-- Loja "encerrada" (falida): o que ela fez até closed_on continua valendo; dali
-- pra frente o saldo devedor na Shopify não pesa no Caixa (A receber não fica
-- negativo, depósito previsto negativo não entra) e reembolso/chargeback com
-- data a partir de closed_on não desconta do lucro. Depósito que cair de
-- verdade continua contando.
alter table public.shops add column if not exists closed_on date;

-- Loja 4 - Woovah: dívida com a Shopify não será paga (reembolsos/chargebacks desde 09/11/2026).
update public.shops set closed_on = '2026-11-09'
 where id = (select id from public.shops where name ilike 'Loja 4%' and closed_on is null limit 1);
