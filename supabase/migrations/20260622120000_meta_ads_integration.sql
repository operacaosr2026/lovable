-- Meta Ads OAuth state tokens (short-lived, one-time use)
CREATE TABLE IF NOT EXISTS public.meta_oauth_states (
  id        uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shop_id   uuid NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  created_at timestamptz DEFAULT now()
);

-- Meta Ads tokens per shop (long-lived, refreshed on reconnect)
CREATE TABLE IF NOT EXISTS public.shop_meta_tokens (
  id                     uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id                uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shop_id                uuid NOT NULL,
  access_token           text NOT NULL,
  token_expires_at       timestamptz,
  fb_user_id             text,
  fb_user_name           text,
  selected_ad_account_id text,
  ad_accounts            jsonb DEFAULT '[]'::jsonb,
  created_at             timestamptz DEFAULT now(),
  updated_at             timestamptz DEFAULT now(),
  UNIQUE (user_id, shop_id)
);

-- RLS
ALTER TABLE public.meta_oauth_states  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_meta_tokens   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_meta_states"  ON public.meta_oauth_states  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "owner_meta_tokens"  ON public.shop_meta_tokens   FOR ALL USING (auth.uid() = user_id);
