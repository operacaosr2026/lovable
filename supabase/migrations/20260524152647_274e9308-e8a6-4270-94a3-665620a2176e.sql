-- Revoke column-level SELECT on sensitive secret columns from the authenticated role
-- so they cannot be read by the client even when RLS would otherwise allow row access.
-- Server functions that legitimately need these columns must use the service role client.

REVOKE SELECT (access_token) ON public.shopify_stores FROM authenticated, anon;
REVOKE SELECT (token) ON public.member_invitations FROM authenticated, anon;