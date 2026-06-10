import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export type AppSettings = {
  user_id: string;
  app_name: string;
  logo_url: string | null;
  favicon_url: string | null;
  primary_color: string;
  language: string;
  timezone: string;
  date_format: string;
  default_home: string;
  theme: "light" | "dark" | "system";
  font_size: "small" | "medium" | "large";
  density: "compact" | "standard" | "comfortable";
};

const DEFAULTS: Omit<AppSettings, "user_id"> = {
  app_name: "SRX Growth",
  logo_url: null,
  favicon_url: null,
  primary_color: "oklch(0.58 0.22 295)",
  language: "pt-BR",
  timezone: "America/Sao_Paulo",
  date_format: "DD/MM/YYYY",
  default_home: "/",
  theme: "system",
  font_size: "medium",
  density: "standard",
};

type Ctx = {
  settings: AppSettings | null;
  loading: boolean;
  update: (patch: Partial<Omit<AppSettings, "user_id">>) => Promise<void>;
  preview: (patch: Partial<Omit<AppSettings, "user_id">>) => void;
  clearPreview: () => void;
};

const AppSettingsContext = createContext<Ctx | null>(null);

function applySettings(s: Partial<AppSettings>) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  if (s.primary_color) {
    root.style.setProperty("--primary", s.primary_color);
    root.style.setProperty("--ring", s.primary_color);
  }

  if (s.theme) {
    const resolved =
      s.theme === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : s.theme;
    root.classList.toggle("dark", resolved === "dark");
  }

  if (s.font_size) {
    const size = s.font_size === "small" ? "14px" : s.font_size === "large" ? "17px" : "15px";
    root.style.setProperty("font-size", size);
  }

  if (s.density) {
    root.setAttribute("data-density", s.density);
  }

  if (s.app_name) {
    document.title = s.app_name;
  }

  if (s.favicon_url !== undefined) {
    let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = s.favicon_url || "/favicon.ico";
  }
}

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["app-settings", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<AppSettings> => {
      const { data: row, error } = await supabase
        .from("app_settings")
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      if (row) return row as AppSettings;

      // Create defaults on first access
      const insert = { user_id: user!.id, ...DEFAULTS };
      const { data: created, error: insErr } = await supabase
        .from("app_settings")
        .insert(insert)
        .select("*")
        .single();
      if (insErr) throw insErr;
      return created as AppSettings;
    },
  });

  const settings = data ?? null;

  // Apply settings whenever they change
  useEffect(() => {
    if (settings) applySettings(settings);
  }, [settings]);

  // Listen for system theme changes when in "system" mode
  useEffect(() => {
    if (!settings || settings.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applySettings({ theme: "system" });
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [settings]);

  const updateMut = useMutation({
    mutationFn: async (patch: Partial<Omit<AppSettings, "user_id">>) => {
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("app_settings")
        .update(patch)
        .eq("user_id", user.id);
      if (error) throw error;
    },
    onSuccess: (_d, patch) => {
      qc.setQueryData(["app-settings", user?.id], (prev: AppSettings | undefined) =>
        prev ? { ...prev, ...patch } : prev
      );
    },
  });

  const update = useCallback(
    async (patch: Partial<Omit<AppSettings, "user_id">>) => {
      applySettings(patch);
      await updateMut.mutateAsync(patch);
    },
    [updateMut]
  );

  const preview = useCallback((patch: Partial<Omit<AppSettings, "user_id">>) => {
    applySettings(patch);
  }, []);

  const clearPreview = useCallback(() => {
    if (settings) applySettings(settings);
  }, [settings]);

  const value = useMemo<Ctx>(
    () => ({ settings, loading: isLoading, update, preview, clearPreview }),
    [settings, isLoading, update, preview, clearPreview]
  );

  return <AppSettingsContext.Provider value={value}>{children}</AppSettingsContext.Provider>;
}

export function useAppSettings() {
  const ctx = useContext(AppSettingsContext);
  if (!ctx) throw new Error("useAppSettings must be used within AppSettingsProvider");
  return ctx;
}

export const HOME_OPTIONS: { value: string; label: string }[] = [
  { value: "/", label: "Dashboard" },
  { value: "/tasks", label: "Tarefas" },
  { value: "/projects", label: "Projetos" },
  { value: "/shops", label: "Ecommerce" },
  { value: "/finance", label: "Financeiro" },
  { value: "/habits", label: "Hábitos" },
  { value: "/calendar", label: "Calendário" },
  { value: "/journal", label: "Diário" },
];

export const TIMEZONE_OPTIONS = [
  "America/Sao_Paulo",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/Lisbon",
  "Europe/London",
  "Europe/Madrid",
  "UTC",
];

export const LANGUAGE_OPTIONS = [
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "en-US", label: "English (US)" },
  { value: "es-ES", label: "Español" },
];

export const DATE_FORMAT_OPTIONS = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"];
