import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";

export const listProjectAttachments = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, ownerId } = context;
    const { data: rows, error } = await supabase
      .from("project_attachments").select("*")
      .eq("user_id", ownerId).eq("project_id", data.project_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const withUrls = await Promise.all((rows ?? []).map(async (r: any) => {
      const { data: signed } = await supabase.storage
        .from("project-attachments")
        .createSignedUrl(r.file_path, 60 * 60);
      return { ...r, url: signed?.signedUrl ?? null };
    }));
    return { attachments: withUrls };
  });

export const registerProjectAttachment = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) =>
    z.object({
      project_id: z.string().uuid(),
      file_name: z.string().min(1).max(300),
      file_path: z.string().min(1).max(500),
      mime_type: z.string().max(120).nullable().optional(),
      size_bytes: z.number().int().nonnegative().nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, ownerId } = context;
    const { data: row, error } = await supabase.from("project_attachments").insert({
      user_id: ownerId,
      project_id: data.project_id,
      file_name: data.file_name,
      file_path: data.file_path,
      mime_type: data.mime_type ?? null,
      size_bytes: data.size_bytes ?? null,
    }).select().single();
    if (error) throw new Error(error.message);
    return { attachment: row };
  });

export const deleteProjectAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { data: row } = await supabase.from("project_attachments").select("file_path").eq("id", data.id).maybeSingle();
    if (row?.file_path) {
      await supabase.storage.from("project-attachments").remove([row.file_path]);
    }
    const { error } = await supabase.from("project_attachments").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
