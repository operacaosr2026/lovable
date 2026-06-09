import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export async function requireAuth() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    // Remember where the user was so we can return them after login.
    if (typeof window !== "undefined") {
      const here = window.location.pathname + window.location.search + window.location.hash;
      if (here && !here.startsWith("/login")) {
        try { sessionStorage.setItem("redirectAfterLogin", here); } catch {}
      }
    }
    throw redirect({ to: "/login" });
  }
}
