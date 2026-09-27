import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupportSettings, saveSupportSettings } from "@/lib/atendimento.functions";
import { useSupportFn } from "./demo";

// Lista fixa de tags (Configurações > Tags). `ensure` inclui na lista as tags
// novas criadas direto numa conversa.
export function useSupportTags() {
  const qc = useQueryClient();
  const getFn = useSupportFn(getSupportSettings, "getSupportSettings");
  const saveFn = useSupportFn(saveSupportSettings, "saveSupportSettings");
  const q = useQuery({ queryKey: ["support-settings"], queryFn: () => getFn(), staleTime: 5 * 60_000 });
  const fixed: string[] = q.data?.tags ?? [];

  const ensure = async (tags: string[]) => {
    if (!q.data) return;
    const missing = tags.filter((t) => !fixed.some((f) => f.toLowerCase() === t.toLowerCase()));
    if (!missing.length) return;
    await saveFn({ data: { tags: [...fixed, ...missing] } });
    qc.invalidateQueries({ queryKey: ["support-settings"] });
  };

  return { fixed, ensure, isLoading: q.isLoading, aiTagsEnabled: q.data?.aiTagsEnabled ?? true, aiAvailable: q.data?.aiAvailable ?? false };
}
