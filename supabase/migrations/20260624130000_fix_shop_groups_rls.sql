DROP POLICY IF EXISTS "owner_shop_groups" ON public.shop_groups;
DROP POLICY IF EXISTS "owner_shop_group_stores" ON public.shop_group_stores;

CREATE POLICY "owner_shop_groups"
  ON public.shop_groups FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "owner_shop_group_stores"
  ON public.shop_group_stores FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.shop_groups g
      WHERE g.id = group_id AND g.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.shop_groups g
      WHERE g.id = group_id AND g.user_id = auth.uid()
    )
  );
