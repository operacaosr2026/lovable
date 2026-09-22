-- Track123 expõe duas APIs distintas: a Open API clássica (Track123-Api-Secret,
-- usada em api.track123.com) e o servidor MCP do app Shopify (shp.track123.com),
-- que exige X-Api-Key + X-Store-Uuid. Quando a loja não tem (ou perdeu) acesso à
-- Open API, usamos o MCP como alternativa — por isso guardamos o store_uuid
-- separado da api_key existente.
ALTER TABLE public.track123_integrations ADD COLUMN IF NOT EXISTS mcp_store_uuid text;
