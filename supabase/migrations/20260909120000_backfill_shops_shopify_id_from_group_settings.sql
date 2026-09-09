-- Shops created via the Grupos flow (syncGroupShops) only ever linked to their
-- Shopify store through shop_order_settings.shopify_store_id — they never got
-- shops.shopify_store_id set. Lojas e Grupos' card picker (listAllShopsForPicker)
-- reads shops.shopify_store_id, so those shops silently never appeared there.
-- Backfill from shop_order_settings, skipping any shop whose Shopify store is
-- already mirrored by a different shops row (avoids creating a duplicate link).
update shops s
set shopify_store_id = sos.shopify_store_id
from shop_order_settings sos
where sos.shop_id = s.id
  and s.shopify_store_id is null
  and sos.shopify_store_id is not null
  and not exists (
    select 1 from shops s2
    where s2.user_id = s.user_id
      and s2.shopify_store_id = sos.shopify_store_id
  );
