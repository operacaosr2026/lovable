-- Reenvio (código de rastreio trocado, à mão ou pela Shopify) sai dos KPIs da
-- Logística automaticamente. Só marca na troca — desmarcar depois na tela vale.
CREATE OR REPLACE FUNCTION public.shop_orders_keep_tracking_history()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(btrim(OLD.tracking_code), '') <> ''
     AND upper(btrim(OLD.tracking_code)) IS DISTINCT FROM upper(btrim(COALESCE(NEW.tracking_code, ''))) THEN
    NEW.tracking_code_history := COALESCE(NEW.tracking_code_history, '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object('code', OLD.tracking_code, 'until', now()));
    NEW.kpi_excluded := true;
  END IF;
  RETURN NEW;
END $$;

-- Reenvios que já existem.
UPDATE public.shop_orders SET kpi_excluded = true
 WHERE NOT kpi_excluded
   AND (tracking_code_manual_at IS NOT NULL OR jsonb_array_length(tracking_code_history) > 0);
