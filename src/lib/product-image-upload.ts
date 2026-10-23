import { supabase } from "@/integrations/supabase/client";

type AddImage = (args: { data: {
  product_id: string; file_path: string; file_url: string | null; file_name: string; mime_type: string; size_bytes: number;
} }) => Promise<{ image: unknown }>;

// Sobe o arquivo pro bucket e cria a product_images. Devolve o id.
export async function uploadProductImage(productId: string, file: File, addImage: AddImage): Promise<string> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Não autenticado");
  const path = `${u.user.id}/products/${productId}/${Date.now()}_${file.name.replace(/[^\w.-]+/g, "_")}`;
  const { error } = await supabase.storage.from("project-attachments").upload(path, file);
  if (error) throw error;
  const { data: signed } = await supabase.storage.from("project-attachments").createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
  const r = await addImage({ data: {
    product_id: productId, file_path: path, file_url: signed?.signedUrl ?? null, file_name: file.name, mime_type: file.type, size_bytes: file.size,
  } });
  return (r.image as { id: string }).id;
}
