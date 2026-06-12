-- Members with "shops" section access can also access the owner's
-- shopify_stores rows (needed for listShopifyStores, connectShopifyStore,
-- and sync status updates). shopify_stores has no shop_id column, so we
-- pass NULL as the resource: any member with a "shops" permission
-- (section-wide or restricted to a specific shop) gets access.
-- Sensitive columns (access_token, client_secret) remain revoked from
-- authenticated users via column privileges.
CREATE POLICY "members access shopify_stores" ON public.shopify_stores FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'shops', NULL))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'shops', NULL));
