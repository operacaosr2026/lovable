-- Saúde da conta de anúncio do card, lida no sync do gasto (lg-card-ad-spend):
--  - account_status: status da conta na Meta (3 = pagamento pendente, 9 = carência);
--  - outside_campaigns: campanhas com gasto nos últimos 3 dias que NÃO estão
--    escolhidas no card (o gasto delas não entra no lucro) — [{id,name,spend}].
alter table public.lg_card_meta_accounts add column if not exists account_status integer;
alter table public.lg_card_meta_accounts add column if not exists outside_campaigns jsonb not null default '[]'::jsonb;
