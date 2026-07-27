-- As tabelas de "Lojas e Grupos" (lg_cards e dependentes) foram criadas depois
-- do padrão de acesso compartilhado (has_workspace_access) e nunca ganharam
-- as políticas de membro correspondentes. Isso faz com que qualquer escrita
-- feita por um membro convidado (onde ownerId != auth.uid()) seja barrada
-- pela RLS, ex: "new row violates row-level security policy for table
-- lg_card_goals" ao tentar salvar uma meta.

CREATE POLICY "members access lg_cards" ON lg_cards FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'shops', NULL))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'shops', NULL));

CREATE POLICY "members access lg_card_shops" ON lg_card_shops FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM lg_cards
      WHERE lg_cards.id = lg_card_shops.card_id
        AND public.has_workspace_access(auth.uid(), lg_cards.user_id, 'shops', NULL)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM lg_cards
      WHERE lg_cards.id = lg_card_shops.card_id
        AND public.has_workspace_access(auth.uid(), lg_cards.user_id, 'shops', NULL)
    )
  );

CREATE POLICY "members access lg_card_notes" ON lg_card_notes FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'shops', NULL))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'shops', NULL));

CREATE POLICY "members access lg_card_goals" ON lg_card_goals FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'shops', NULL))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'shops', NULL));

CREATE POLICY "members access lg_card_currency_rates" ON lg_card_currency_rates FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'shops', NULL))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'shops', NULL));

CREATE POLICY "members access shop_daily_analytics" ON shop_daily_analytics FOR ALL
  USING (public.has_workspace_access(auth.uid(), user_id, 'shops', NULL))
  WITH CHECK (public.has_workspace_access(auth.uid(), user_id, 'shops', NULL));
