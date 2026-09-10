-- Cópia isolada dos lançamentos de Caixa usada pela tela consolidada geral
-- (menu "Caixa"). Os dados chegam de shop_cash_entries (sync com a Shopify
-- continua escrevendo lá normalmente), mas editar/excluir/conciliar aqui não
-- deve alterar o registro original usado pela loja individual ou pelo Grupo.
--
-- source_entry_id aponta pro lançamento original quando o override é uma
-- edição/exclusão de algo que veio de lá; fica NULL quando o lançamento foi
-- criado direto nessa tela (não existe na origem).
CREATE TABLE public.shop_cash_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  shop_id UUID NOT NULL,
  source_entry_id UUID REFERENCES public.shop_cash_entries(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('income','expense')),
  category TEXT,
  description TEXT,
  amount NUMERIC NOT NULL DEFAULT 0,
  date DATE NOT NULL,
  recurrence TEXT NOT NULL DEFAULT 'none',
  recurrence_until DATE,
  skip_weekend_rule BOOLEAN NOT NULL DEFAULT false,
  reconciled BOOLEAN NOT NULL DEFAULT false,
  deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.shop_cash_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own shop_cash_overrides all" ON public.shop_cash_overrides
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- No máximo 1 override por lançamento original (upsert por source_entry_id).
CREATE UNIQUE INDEX idx_shop_cash_overrides_source ON public.shop_cash_overrides(user_id, source_entry_id)
  WHERE source_entry_id IS NOT NULL;
CREATE INDEX idx_shop_cash_overrides_shop_date ON public.shop_cash_overrides(shop_id, date);

CREATE TRIGGER shop_cash_overrides_updated_at BEFORE UPDATE ON public.shop_cash_overrides
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
