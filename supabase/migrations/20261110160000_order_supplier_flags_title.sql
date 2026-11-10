-- Resposta do fornecedor registrada pela tela (Gerencial › Alertas › "Resposta
-- do fornecedor"): kind = sem_estoque | vai_postar | outro, title = título do
-- alerta (no "outro", escrito por quem registrou). Uma resposta ativa por
-- pedido — a mais nova substitui a anterior.
ALTER TABLE public.order_supplier_flags ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.order_supplier_flags DROP CONSTRAINT IF EXISTS order_supplier_flags_pkey;
ALTER TABLE public.order_supplier_flags ADD PRIMARY KEY (owner_id, order_id);
