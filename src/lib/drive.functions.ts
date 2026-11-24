import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { DRIVE_FOLDER_MIME, driveFileMeta, driveListFolder, parseDriveLink, type DriveFile } from "@/lib/drive.server";
import { createCreativeFromDrive } from "@/lib/creative-drive.server";

// Produção › Criativos › Importar do Drive: lista uma pasta pública e cria um
// criativo por arquivo. O arquivo continua no Drive; aqui fica só a miniatura.

const db = (table: string) => (supabaseAdmin as any).from(table);

export type DriveEntry = {
  id: string; name: string; kind: "video" | "image"; mimeType: string;
  size: number | null; duration: number | null; thumb: string; imported: boolean;
};

const thumbUrlFor = (f: Pick<DriveFile, "id" | "thumbnailLink">) =>
  f.thumbnailLink?.replace(/=s\d+$/, "=s400") ?? `https://drive.google.com/thumbnail?id=${f.id}&sz=w400`;

export const listDriveFolder = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ product_id: z.string().uuid(), link: z.string().trim().min(5).max(2000) }).parse(d))
  .handler(async ({ context, data }) => {
    const link = parseDriveLink(data.link);
    if (!link) throw new Error("Isso não parece um link do Google Drive.");

    const meta = await driveFileMeta(link.id);
    const isFolder = meta.mimeType === DRIVE_FOLDER_MIME;
    const items = isFolder ? await driveListFolder(meta.id) : [meta];

    const folders = items.filter((f) => f.mimeType === DRIVE_FOLDER_MIME).map((f) => ({ id: f.id, name: f.name }));
    const media = items.filter((f) => f.mimeType.startsWith("video/") || f.mimeType.startsWith("image/"));
    const others = items.length - folders.length - media.length;

    const { data: existing } = media.length
      ? await db("product_creatives").select("drive_file_id").eq("user_id", context.ownerId).eq("product_id", data.product_id).in("drive_file_id", media.map((f) => f.id))
      : { data: [] };
    const imported = new Set(((existing ?? []) as any[]).map((r) => r.drive_file_id as string));

    const files: DriveEntry[] = media.map((f) => ({
      id: f.id,
      name: f.name,
      kind: f.mimeType.startsWith("video/") ? "video" : "image",
      mimeType: f.mimeType,
      size: f.size ? Number(f.size) : null,
      duration: f.videoMediaMetadata?.durationMillis ? Math.round(Number(f.videoMediaMetadata.durationMillis) / 1000) : null,
      thumb: thumbUrlFor(f),
      imported: imported.has(f.id),
    }));

    return { folder: { id: meta.id, name: meta.name, is_folder: isFolder }, folders, files, others };
  });

export const importDriveFiles = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    product_id: z.string().uuid(),
    files: z.array(z.object({
      id: z.string().min(5).max(200),
      name: z.string().max(500),
      kind: z.enum(["video", "image"]),
    })).min(1).max(20),
    folder_id: z.string().uuid().nullable().optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { ownerId } = context;
    const { data: product } = await supabaseAdmin.from("products").select("id").eq("id", data.product_id).eq("user_id", ownerId).maybeSingle();
    if (!product) throw new Error("Produto não encontrado");

    const { data: existing } = await db("product_creatives").select("drive_file_id")
      .eq("user_id", ownerId).eq("product_id", data.product_id).in("drive_file_id", data.files.map((f) => f.id));
    const already = new Set(((existing ?? []) as any[]).map((r) => r.drive_file_id as string));

    const { data: top } = await supabaseAdmin.from("product_creatives").select("position")
      .eq("product_id", data.product_id).eq("status", "lancar").order("position", { ascending: true }).limit(1).maybeSingle();
    let position = (top?.position ?? 0) - 1;

    const errors: { name: string; error: string }[] = [];
    let created = 0;
    // Ordem invertida: o primeiro da lista fica em cima (posição menor).
    for (const f of [...data.files].reverse()) {
      if (already.has(f.id)) continue;
      try {
        const meta = await driveFileMeta(f.id);
        await createCreativeFromDrive(ownerId, data.product_id, meta, { folder_id: data.folder_id ?? null, position: position-- });
        created++;
      } catch (e: any) {
        errors.push({ name: f.name, error: String(e.message).slice(0, 300) });
      }
    }
    return { created, skipped: already.size, errors };
  });
