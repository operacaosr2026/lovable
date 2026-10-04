-- Rastreamento > "Avisar cliente": quando o cliente recebeu o e-mail
-- "Update on your order" (a lista mostra "Avisado dd/mm" e a confirmação avisa
-- se o pedido já foi avisado).
ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS customer_notified_at timestamptz;

-- Reverter:
-- ALTER TABLE public.shop_orders DROP COLUMN customer_notified_at;
