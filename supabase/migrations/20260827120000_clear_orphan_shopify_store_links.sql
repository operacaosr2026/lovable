-- shop_order_settings.shopify_store_id has no DB-level FK/cascade to shopify_stores,
-- so deleting a Shopify store left dangling references pointing at rows that no
-- longer exist. Clear those out.
update shop_order_settings
set shopify_store_id = null
where shopify_store_id is not null
  and not exists (
    select 1 from shopify_stores where shopify_stores.id = shop_order_settings.shopify_store_id
  );
