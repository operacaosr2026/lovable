-- `shops` (business entity used by Lojas e Grupos) is now kept in sync with
-- `shopify_stores` (Banco de Lojas) via this soft link, set/cleared by the app
-- whenever a Shopify store is connected/renamed/deleted. Backfill existing
-- rows that already match by name so current cards keep their shop.
alter table shops add column if not exists shopify_store_id uuid;

update shops s
set shopify_store_id = ss.id
from shopify_stores ss
where s.user_id = ss.user_id
  and s.name = ss.name
  and s.shopify_store_id is null;
