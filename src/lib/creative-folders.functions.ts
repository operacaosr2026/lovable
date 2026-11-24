import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { DRIVE_FOLDER_MIME, driveFileMeta, driveListFolder, parseDriveLink, driveViewUrl } from "@/lib/drive.server";
import { createCreativeFromDrive, driveTree } from "@/lib/creative-drive.server";

// Produto › Criativos: pastas (ex.: uma por cor) e a pasta "Criativos" do Drive
// ligada ao produto. Sincronizar traz os arquivos novos e cria as pastas a partir
// das subpastas do Drive.

const db = (table: string) => (supabaseAdmin as any).from(table);

export type CreativeFolder = { id: string; name: string; drive_folder_id: string | null; position: number };

async function ownProduct(ownerId: string, productId: string) {
  const { data } = await db("products").select("id,creatives_drive_folder_id,creatives_drive_folder_name,creatives_drive_synced_at")
    .eq("id", productId).eq("user_id", ownerId).maybeSingle();
  if (!data) throw new Error("Produto não encontrado");
  return data as { id: string; creatives_drive_folder_id: string | null; creatives_drive_folder_name: string | null; creatives_drive_synced_at: string | null };
}

async function ownFolder(ownerId: string, id: string) {
  const { data } = await db("product_creative_folders").select("id,product_id").eq("id", id).eq("user_id", ownerId).maybeSingle();
  if (!data) throw new Error("Pasta não encontrada");
  return data as { id: string; product_id: string };
}

export const listCreativeFolders = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ product_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const product = await ownProduct(context.ownerId, data.product_id);
    const { data: rows, error } = await db("product_creative_folders").select("id,name,drive_folder_id,position")
      .eq("product_id", data.product_id).eq("user_id", context.ownerId)
      .order("position", { ascending: true }).order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return {
      folders: (rows ?? []) as CreativeFolder[],
      drive: product.creatives_drive_folder_id
        ? { id: product.creatives_drive_folder_id, name: product.creatives_drive_folder_name ?? "Criativos", synced_at: product.creatives_drive_synced_at }
        : null,
    };
  });

const nextPosition = async (productId: string) => {
  const { data } = await db("product_creative_folders").select("position").eq("product_id", productId)
    .order("position", { ascending: false }).limit(1).maybeSingle();
  return ((data?.position as number | undefined) ?? -1) + 1;
};

export const createCreativeFolder = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ product_id: z.string().uuid(), name: z.string().trim().min(1).max(80) }).parse(d))
  .handler(async ({ context, data }) => {
    await ownProduct(context.ownerId, data.product_id);
    const { data: row, error } = await db("product_creative_folders").insert({
      user_id: context.ownerId, product_id: data.product_id, name: data.name, position: await nextPosition(data.product_id),
    }).select("id,name,drive_folder_id,position").single();
    if (error) throw new Error(error.message);
    return row as CreativeFolder;
  });

export const renameCreativeFolder = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(80) }).parse(d))
  .handler(async ({ context, data }) => {
    await ownFolder(context.ownerId, data.id);
    const { error } = await db("product_creative_folders").update({ name: data.name }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Apagar a pasta não apaga os criativos: eles ficam "sem pasta".
export const deleteCreativeFolder = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await ownFolder(context.ownerId, data.id);
    const { error } = await db("product_creative_folders").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const moveCreativesToFolder = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ ids: z.array(z.string().uuid()).min(1).max(500), folder_id: z.string().uuid().nullable() }).parse(d))
  .handler(async ({ context, data }) => {
    if (data.folder_id) await ownFolder(context.ownerId, data.folder_id);
    const { error } = await db("product_creatives").update({ folder_id: data.folder_id })
      .in("id", data.ids).eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Liga (ou troca) a pasta "Criativos" do Drive do produto.
export const linkCreativesDrive = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ product_id: z.string().uuid(), link: z.string().trim().min(5).max(2000) }).parse(d))
  .handler(async ({ context, data }) => {
    const product = await ownProduct(context.ownerId, data.product_id);
    const link = parseDriveLink(data.link);
    if (!link) throw new Error("Isso não parece um link do Google Drive.");
    const meta = await driveFileMeta(link.id);
    if (meta.mimeType !== DRIVE_FOLDER_MIME) throw new Error("O link precisa ser de uma pasta (a pasta Criativos), não de um arquivo.");
    // Trocou de pasta: o que veio da anterior deixa de ser acompanhado (não marca como "sumiu").
    if (product.creatives_drive_folder_id && product.creatives_drive_folder_id !== meta.id) {
      await db("product_creatives").update({ drive_parent_id: null, drive_missing: false }).eq("product_id", data.product_id).eq("user_id", context.ownerId);
    }
    const { error } = await db("products").update({ creatives_drive_folder_id: meta.id, creatives_drive_folder_name: meta.name }).eq("id", data.product_id);
    if (error) throw new Error(error.message);
    // Criativos que já estavam aqui (subidos do computador): a tela pergunta de qual subpasta são.
    const { count } = await db("product_creatives").select("id", { count: "exact", head: true })
      .eq("product_id", data.product_id).eq("user_id", context.ownerId).is("drive_file_id", null);
    const subfolders = (await driveListFolder(meta.id)).filter((f) => f.mimeType === DRIVE_FOLDER_MIME).map((f) => ({ id: f.id, name: f.name }));
    return { id: meta.id, name: meta.name, subfolders, local_count: (count ?? 0) as number };
  });

export const unlinkCreativesDrive = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ product_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await ownProduct(context.ownerId, data.product_id);
    await db("product_creatives").update({ drive_parent_id: null, drive_missing: false }).eq("product_id", data.product_id).eq("user_id", context.ownerId);
    const { error } = await db("products").update({ creatives_drive_folder_id: null, creatives_drive_folder_name: null, creatives_drive_synced_at: null }).eq("id", data.product_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Lê a pasta ligada: cria/renomeia as pastas, traz até `max_new` arquivos novos
// (a tela chama de novo enquanto `remaining` > 0) e marca o que sumiu do Drive.
export const syncCreativesDrive = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    product_id: z.string().uuid(),
    max_new: z.number().int().min(1).max(20).default(8),
    // Pasta do Drive (raiz ou subpasta) de onde vieram os criativos que já estavam aqui.
    adopt_from: z.string().min(5).max(200).optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { ownerId } = context;
    const product = await ownProduct(ownerId, data.product_id);
    const rootId = product.creatives_drive_folder_id;
    if (!rootId) return { linked: false, created: 0, remaining: 0, missing: 0, errors: [] as string[] };

    const tree = await driveTree(rootId);
    const hasSub = tree.subfolders.length > 0;
    const looseAtRoot = tree.files.some((f) => f.top === rootId);

    // Pastas: uma por subpasta do Drive (+ "Geral" pros soltos na raiz quando há subpastas).
    const { data: existingFolders } = await db("product_creative_folders").select("id,name,drive_folder_id")
      .eq("product_id", data.product_id).eq("user_id", ownerId);
    const byDrive = new Map(((existingFolders ?? []) as any[]).filter((f) => f.drive_folder_id).map((f) => [f.drive_folder_id as string, f]));
    const wanted = [...tree.subfolders, ...(hasSub && looseAtRoot ? [{ id: rootId, name: "Geral" }] : [])];
    let pos = await nextPosition(data.product_id);
    for (const sf of wanted) {
      const cur = byDrive.get(sf.id);
      if (cur) {
        if (sf.id !== rootId && cur.name !== sf.name) await db("product_creative_folders").update({ name: sf.name }).eq("id", cur.id);
        continue;
      }
      const { data: row } = await db("product_creative_folders").insert({
        user_id: ownerId, product_id: data.product_id, name: sf.name, drive_folder_id: sf.id, position: pos++,
      }).select("id,name,drive_folder_id").single();
      if (row) byDrive.set(sf.id, row);
    }
    const folderFor = (top: string) => (hasSub ? byDrive.get(top)?.id ?? null : null);

    // Criativos que já existem: atualiza de onde vieram e põe na pasta se ainda não têm.
    const { data: existing } = await db("product_creatives").select("id,drive_file_id,drive_parent_id,folder_id,drive_missing")
      .eq("product_id", data.product_id).eq("user_id", ownerId).not("drive_file_id", "is", null);
    const byFile = new Map(((existing ?? []) as any[]).map((c) => [c.drive_file_id as string, c]));
    const seen = new Set<string>();
    let fresh: typeof tree.files = [];
    for (const f of tree.files) {
      if (seen.has(f.file.id)) continue;
      seen.add(f.file.id);
      const cur = byFile.get(f.file.id);
      if (!cur) { fresh.push(f); continue; }
      const folder_id = cur.folder_id ?? folderFor(f.top);
      if (cur.drive_parent_id !== f.parent || cur.drive_missing || cur.folder_id !== folder_id) {
        await db("product_creatives").update({ drive_parent_id: f.parent, drive_missing: false, folder_id }).eq("id", cur.id);
      }
    }

    // Criativos subidos do computador: liga ao arquivo do Drive de mesmo nome em vez de importar de novo.
    // Com adopt_from: só arquivos daquela pasta, e os que sobrarem vão pra ela. Sem: só nome único.
    const norm = (n: string) => n.replace(/\.[a-z0-9]{2,5}$/i, "").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
    const { data: localRows } = await db("product_creatives").select("id,name,folder_id")
      .eq("product_id", data.product_id).eq("user_id", ownerId).is("drive_file_id", null);
    const local = ((localRows ?? []) as any[]).filter((c) => c.name);
    if (local.length && fresh.length) {
      const scope = data.adopt_from;
      const pool = scope ? fresh.filter((f) => f.top === scope) : [...fresh];
      const adopted = new Set<string>();
      const nameCount = new Map<string, number>();
      for (const f of fresh) nameCount.set(norm(f.file.name), (nameCount.get(norm(f.file.name)) ?? 0) + 1);
      const used = new Set<string>();
      for (const f of pool) {
        const key = norm(f.file.name);
        if (!scope && (nameCount.get(key) ?? 0) > 1) continue; // mesmo nome em duas cores: não dá pra saber qual
        const match = local.find((c) => !used.has(c.id) && norm(c.name) === key);
        if (!match) continue;
        used.add(match.id);
        await db("product_creatives").update({
          drive_file_id: f.file.id, drive_url: driveViewUrl(f.file.id), drive_parent_id: f.parent, drive_missing: false,
          folder_id: match.folder_id ?? folderFor(f.top),
        }).eq("id", match.id);
        adopted.add(f.file.id);
      }
      fresh = fresh.filter((f) => !adopted.has(f.file.id));
      if (scope) {
        const fid = folderFor(scope);
        const rest = local.filter((c) => !used.has(c.id) && !c.folder_id).map((c) => c.id);
        if (fid && rest.length) await db("product_creatives").update({ folder_id: fid }).in("id", rest);
      }
    }

    // Sumiu do Drive: só marca (não apaga — pode estar em campanha).
    const gone = ((existing ?? []) as any[]).filter((c) => c.drive_parent_id && !seen.has(c.drive_file_id) && !c.drive_missing).map((c) => c.id);
    if (gone.length) await db("product_creatives").update({ drive_missing: true }).in("id", gone);

    // Novos: no máximo max_new por chamada (cada um baixa a miniatura).
    const { data: top } = await supabaseAdmin.from("product_creatives").select("position")
      .eq("product_id", data.product_id).order("position", { ascending: true }).limit(1).maybeSingle();
    let position = (top?.position ?? 0) - 1;
    const errors: string[] = [];
    let created = 0;
    for (const f of fresh.slice(0, data.max_new)) {
      try {
        await createCreativeFromDrive(ownerId, data.product_id, f.file, { folder_id: folderFor(f.top), drive_parent_id: f.parent, position: position-- });
        created++;
      } catch (e: any) {
        errors.push(`${f.file.name}: ${String(e.message).slice(0, 200)}`);
      }
    }
    const remaining = Math.max(0, fresh.length - data.max_new);
    if (!remaining) await db("products").update({ creatives_drive_synced_at: new Date().toISOString() }).eq("id", data.product_id);
    const missing = ((existing ?? []) as any[]).filter((c) => c.drive_parent_id && !seen.has(c.drive_file_id)).length;
    return { linked: true, created, remaining, missing, errors };
  });
