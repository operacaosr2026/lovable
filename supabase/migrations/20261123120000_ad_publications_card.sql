-- Subir campanha: a conta de anúncio vem do card de Lojas e Grupos, não mais da loja.
ALTER TABLE public.product_ad_publications ALTER COLUMN shop_id DROP NOT NULL;
ALTER TABLE public.product_ad_publications ADD COLUMN IF NOT EXISTS card_id uuid REFERENCES public.lg_cards(id) ON DELETE SET NULL;
