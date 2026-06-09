
-- Revoke direct API access to sensitive credential columns.
-- They remain accessible to server-side admin code via supabaseAdmin (service_role).

REVOKE SELECT (access_token, client_secret) ON public.shopify_stores FROM anon, authenticated;
REVOKE INSERT (access_token, client_secret), UPDATE (access_token, client_secret) ON public.shopify_stores FROM anon, authenticated;

REVOKE SELECT (client_secret) ON public.shopify_oauth_states FROM anon, authenticated;
REVOKE INSERT (client_secret), UPDATE (client_secret) ON public.shopify_oauth_states FROM anon, authenticated;

REVOKE SELECT (api_key, token, webhook_secret) ON public.track123_integrations FROM anon, authenticated;
REVOKE INSERT (api_key, token, webhook_secret), UPDATE (api_key, token, webhook_secret) ON public.track123_integrations FROM anon, authenticated;
