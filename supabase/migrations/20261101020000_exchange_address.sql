-- Troca: endereço de entrega diferente do pedido (opcional, alterado no
-- "Gerar troca"). Mesmo formato do shipping_address da Shopify (first_name,
-- last_name, address1, address2, city, province_code, zip, country_code, phone).
-- Vazio = usa o endereço do pedido original.
ALTER TABLE public.support_exchange_requests ADD COLUMN IF NOT EXISTS shipping_address jsonb;

-- Reverter: ALTER TABLE public.support_exchange_requests DROP COLUMN shipping_address;
