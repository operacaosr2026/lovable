import { supabase } from "@/integrations/supabase/client";
import { createTrainingUpload, getTrainingFileUrl } from "@/lib/training.functions";

// Imagens/arquivos dentro do conteúdo ficam gravados como "training://<caminho>"
// e viram URL assinada na hora de mostrar (o bucket é privado).
export const TRAINING_SCHEME = "training://";

export async function uploadTrainingFile(file: File): Promise<string> {
  const { path, token } = await createTrainingUpload({ data: { name: file.name } });
  const { error } = await supabase.storage.from("training").uploadToSignedUrl(path, token, file, {
    contentType: file.type || undefined,
  });
  if (error) throw error;
  return path;
}

const cache = new Map<string, { url: string; at: number }>();

export async function trainingFileUrl(path: string, download?: string): Promise<string> {
  const key = `${path}|${download ?? ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60 * 60 * 1000) return hit.url;
  const { url } = await getTrainingFileUrl({ data: { path, download } });
  cache.set(key, { url, at: Date.now() });
  return url;
}
