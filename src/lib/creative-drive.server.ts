import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { DRIVE_FOLDER_MIME, driveListFolder, driveThumbnail, driveViewUrl, type DriveFile } from "@/lib/drive.server";

const BUCKET = "project-attachments";
const db = (table: string) => (supabaseAdmin as any).from(table);

export const isDriveMedia = (f: Pick<DriveFile, "mimeType">) => f.mimeType.startsWith("video/") || f.mimeType.startsWith("image/");

// Cria o criativo a partir de um arquivo do Drive: guarda só a miniatura, o arquivo fica no Drive.
export async function createCreativeFromDrive(ownerId: string, productId: string, f: DriveFile, extra: { folder_id?: string | null; drive_parent_id?: string | null; position: number }) {
  let thumb_path: string | null = null;
  let thumb_url: string | null = null;
  const t = await driveThumbnail(f);
  if (t) {
    thumb_path = `${ownerId}/products/${productId}/creatives/drive_${f.id}.${t.type.includes("png") ? "png" : "jpg"}`;
    const up = await supabaseAdmin.storage.from(BUCKET).upload(thumb_path, t.bytes, { contentType: t.type, upsert: true });
    if (up.error) thumb_path = null;
    else {
      const { data: signed } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(thumb_path, 60 * 60 * 24 * 365 * 5);
      thumb_url = signed?.signedUrl ?? null;
    }
  }
  const { error } = await db("product_creatives").insert({
    user_id: ownerId,
    product_id: productId,
    name: f.name.replace(/\.[a-z0-9]{2,5}$/i, ""),
    title: "",
    titles: [],
    descriptions: [],
    status: "lancar",
    media_kind: f.mimeType.startsWith("video/") ? "video" : "image",
    media_path: null,
    media_url: thumb_url,
    drive_file_id: f.id,
    drive_url: driveViewUrl(f.id),
    thumb_path,
    thumb_url,
    folder_id: extra.folder_id ?? null,
    drive_parent_id: extra.drive_parent_id ?? null,
    position: extra.position,
  });
  if (error) throw new Error(error.message);
}

// Pasta "Criativos" do Drive: subpastas de 1º nível viram pastas; arquivos de
// sub-subpastas contam na subpasta de 1º nível de onde vieram.
export type DriveTree = {
  subfolders: { id: string; name: string }[];
  files: { file: DriveFile; parent: string; top: string }[]; // top = raiz ou subpasta de 1º nível
  scanned: string[]; // todas as pastas lidas
};

export async function driveTree(rootId: string, maxDepth = 3): Promise<DriveTree> {
  const tree: DriveTree = { subfolders: [], files: [], scanned: [] };
  const walk = async (folderId: string, top: string, depth: number) => {
    tree.scanned.push(folderId);
    const items = await driveListFolder(folderId);
    for (const f of items) {
      if (f.mimeType === DRIVE_FOLDER_MIME) {
        if (depth === 0) tree.subfolders.push({ id: f.id, name: f.name });
        if (depth < maxDepth) await walk(f.id, depth === 0 ? f.id : top, depth + 1);
      } else if (isDriveMedia(f)) {
        tree.files.push({ file: f, parent: folderId, top });
      }
    }
  };
  await walk(rootId, rootId, 0);
  return tree;
}
