-- Order fetching (listOrders, payouts, etc.) reads shop_order_settings.shopify_store_id,
-- which is a separate link from the shops.shopify_store_id mirror added earlier.
-- Backfill only where it's currently unset, so any pre-existing (even if
-- mismatched) manual link is left untouched.
update shop_order_settings sos
set shopify_store_id = s.shopify_store_id
from shops s
where sos.shop_id = s.id
  and sos.shopify_store_id is null
  and s.shopify_store_id is not null;
