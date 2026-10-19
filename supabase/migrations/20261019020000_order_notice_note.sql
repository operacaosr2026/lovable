-- Aba Notificações: nota livre da equipe por pedido (ex.: "cliente pediu pra
-- esperar", "já falei no WhatsApp"). Separada de logistics_note, que o sync do
-- 17track preenche sozinho com o problema do envio.
ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS notice_note text;
