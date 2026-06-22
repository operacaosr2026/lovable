import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export async function requireAuth({ location }: { location: { pathname: string; searchStr?: string; href?: string; search?: any } } = { location: { pathname: "/" } }) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    const here = location.href ?? (location.pathname + (location.searchStr ?? ""));
    const safeRedirect = here && !here.startsWith("/login") ? here : undefined;
    throw redirect({
      to: "/login",
      search: safeRedirect ? { redirect: safeRedirect } : {},
    });
  }
}
