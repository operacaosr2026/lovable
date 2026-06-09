REVOKE SELECT (access_token, scope) ON public.shopify_stores FROM authenticated;
REVOKE SELECT (access_token, scope) ON public.shopify_stores FROM anon;