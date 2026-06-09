DELETE FROM public.transactions a USING public.transactions b WHERE a.ctid < b.ctid AND a.user_id = b.user_id AND a.account_id = b.account_id AND a.external_id IS NOT NULL AND a.external_id = b.external_id;

ALTER TABLE public.transactions ADD CONSTRAINT transactions_user_account_external_unique UNIQUE (user_id, account_id, external_id);