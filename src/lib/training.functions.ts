import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOwnerContext, type WorkspacePermission, type WorkspaceRole } from "@/integrations/supabase/workspace-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";

// Academia: trilhas de treinamento → aulas (documento, vídeo, fluxograma,
// mapa mental, arquivo). Ver = permissão "academia"; criar/editar e ver o
// progresso da equipe = "ac_editar" (admin pode tudo).

export const LESSON_KINDS = ["doc", "video", "flow", "mindmap", "file"] as const;
export type LessonKind = (typeof LESSON_KINDS)[number];

export type TrainingTrack = {
  id: string; title: string; description: string | null; color: string; emoji: string | null; position: number;
};
export type TrainingTrackSummary = TrainingTrack & { lessons: number; done: number; minutes: number };
export type TrainingLesson = {
  id: string; track_id: string; title: string; kind: LessonKind; content: Record<string, any>;
  duration_min: number | null; position: number; updated_at: string;
};

const BUCKET = "training";

type Ctx = { role: WorkspaceRole; permissions: WorkspacePermission[] };
const canView = (c: Ctx) => c.role === "admin" || c.permissions.some((p) => p.section === "academia");
const canEdit = (c: Ctx) => c.role === "admin" || c.permissions.some((p) => p.section === "ac_editar");
function assertView(c: Ctx) {
  if (!canView(c)) throw new Error("Sem acesso à Academia");
}
function assertEdit(c: Ctx) {
  if (!canEdit(c)) throw new Error("Sem permissão para editar a Academia");
}

async function assertTrack(ownerId: string, trackId: string) {
  const { data } = await supabaseAdmin.from("training_tracks").select("id")
    .eq("id", trackId).eq("user_id", ownerId).maybeSingle();
  if (!data) throw new Error("Trilha não encontrada");
}

// ── Trilhas ──

export const listTrainingTracks = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .handler(async ({ context }) => {
    assertView(context);
    const ownerId = context.ownerId;
    const [tracks, lessons, progress] = await Promise.all([
      supabaseAdmin.from("training_tracks").select("id,title,description,color,emoji,position")
        .eq("user_id", ownerId).order("position").order("created_at"),
      supabaseAdmin.from("training_lessons").select("id,track_id,duration_min").eq("user_id", ownerId),
      supabaseAdmin.from("training_progress").select("lesson_id")
        .eq("user_id", ownerId).eq("member_id", context.userId),
    ]);
    if (tracks.error) throw new Error(tracks.error.message);
    if (lessons.error) throw new Error(lessons.error.message);
    const doneSet = new Set((progress.data ?? []).map((p) => p.lesson_id));
    const stats: Record<string, { lessons: number; done: number; minutes: number }> = {};
    for (const l of lessons.data ?? []) {
      const s = (stats[l.track_id] ??= { lessons: 0, done: 0, minutes: 0 });
      s.lessons++;
      s.minutes += l.duration_min ?? 0;
      if (doneSet.has(l.id)) s.done++;
    }
    return {
      canEdit: canEdit(context),
      tracks: (tracks.data ?? []).map((t) => ({ ...t, ...(stats[t.id] ?? { lessons: 0, done: 0, minutes: 0 }) })) as TrainingTrackSummary[],
    };
  });

const TrackInput = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullable(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  emoji: z.string().max(16).nullable(),
});

export const saveTrainingTrack = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => TrackInput.parse(d))
  .handler(async ({ context, data }) => {
    assertEdit(context);
    const { id, ...fields } = data;
    if (id) {
      const { error } = await supabaseAdmin.from("training_tracks").update(fields)
        .eq("id", id).eq("user_id", context.ownerId);
      if (error) throw new Error(error.message);
      return { id };
    }
    const { count } = await supabaseAdmin.from("training_tracks").select("id", { count: "exact", head: true })
      .eq("user_id", context.ownerId);
    const { data: row, error } = await supabaseAdmin.from("training_tracks")
      .insert({ ...fields, user_id: context.ownerId, position: count ?? 0 }).select("id").single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const deleteTrainingTrack = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    assertEdit(context);
    const { data: lessons } = await supabaseAdmin.from("training_lessons").select("content")
      .eq("track_id", data.id).eq("user_id", context.ownerId);
    const paths = (lessons ?? []).flatMap((l) => filePaths(l.content as Record<string, any>, context.ownerId));
    const { error } = await supabaseAdmin.from("training_tracks").delete()
      .eq("id", data.id).eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    if (paths.length) await supabaseAdmin.storage.from(BUCKET).remove(paths);
    return { ok: true };
  });

export const reorderTrainingTracks = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ ids: z.array(z.string().uuid()).max(500) }).parse(d))
  .handler(async ({ context, data }) => {
    assertEdit(context);
    await Promise.all(data.ids.map((id, i) =>
      supabaseAdmin.from("training_tracks").update({ position: i }).eq("id", id).eq("user_id", context.ownerId)));
    return { ok: true };
  });

// ── Trilha aberta ──

export const getTrainingTrack = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    assertView(context);
    const ownerId = context.ownerId;
    const [track, lessons] = await Promise.all([
      supabaseAdmin.from("training_tracks").select("id,title,description,color,emoji,position")
        .eq("id", data.id).eq("user_id", ownerId).maybeSingle(),
      supabaseAdmin.from("training_lessons")
        .select("id,track_id,title,kind,content,duration_min,position,updated_at")
        .eq("track_id", data.id).eq("user_id", ownerId).order("position").order("created_at"),
    ]);
    if (!track.data) throw new Error("Trilha não encontrada");
    if (lessons.error) throw new Error(lessons.error.message);
    const ids = (lessons.data ?? []).map((l) => l.id);
    const { data: progress } = ids.length
      ? await supabaseAdmin.from("training_progress").select("lesson_id")
        .eq("member_id", context.userId).in("lesson_id", ids)
      : { data: [] as { lesson_id: string }[] };
    return {
      canEdit: canEdit(context),
      track: track.data as TrainingTrack,
      lessons: (lessons.data ?? []) as unknown as TrainingLesson[],
      done: (progress ?? []).map((p) => p.lesson_id),
    };
  });

// ── Aulas ──

const EMPTY_CONTENT: Record<LessonKind, Record<string, unknown>> = {
  doc: { blocks: null },
  video: { url: "" },
  flow: { nodes: [], edges: [] },
  mindmap: { nodes: [], edges: [] },
  file: {},
};

export const createTrainingLesson = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    track_id: z.string().uuid(),
    kind: z.enum(LESSON_KINDS),
    title: z.string().trim().min(1).max(200),
  }).parse(d))
  .handler(async ({ context, data }) => {
    assertEdit(context);
    await assertTrack(context.ownerId, data.track_id);
    const { count } = await supabaseAdmin.from("training_lessons").select("id", { count: "exact", head: true })
      .eq("track_id", data.track_id);
    const { data: row, error } = await supabaseAdmin.from("training_lessons").insert({
      user_id: context.ownerId, track_id: data.track_id, kind: data.kind, title: data.title,
      content: EMPTY_CONTENT[data.kind] as Json, position: count ?? 0,
    }).select("id").single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const updateTrainingLesson = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({
    id: z.string().uuid(),
    patch: z.object({
      title: z.string().trim().min(1).max(200).optional(),
      content: z.record(z.any()).optional(),
      duration_min: z.number().int().min(0).max(1440).nullable().optional(),
    }),
  }).parse(d))
  .handler(async ({ context, data }) => {
    assertEdit(context);
    if (data.patch.content && JSON.stringify(data.patch.content).length > 2_000_000) {
      throw new Error("Conteúdo grande demais");
    }
    const { error } = await supabaseAdmin.from("training_lessons")
      .update(data.patch as { title?: string; content?: Json; duration_min?: number | null })
      .eq("id", data.id).eq("user_id", context.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteTrainingLesson = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    assertEdit(context);
    const { data: lesson } = await supabaseAdmin.from("training_lessons").select("content")
      .eq("id", data.id).eq("user_id", context.ownerId).maybeSingle();
    if (!lesson) return { ok: true };
    const { error } = await supabaseAdmin.from("training_lessons").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    const paths = filePaths(lesson.content as Record<string, any>, context.ownerId);
    if (paths.length) await supabaseAdmin.storage.from(BUCKET).remove(paths);
    return { ok: true };
  });

export const reorderTrainingLessons = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ ids: z.array(z.string().uuid()).max(500) }).parse(d))
  .handler(async ({ context, data }) => {
    assertEdit(context);
    await Promise.all(data.ids.map((id, i) =>
      supabaseAdmin.from("training_lessons").update({ position: i }).eq("id", id).eq("user_id", context.ownerId)));
    return { ok: true };
  });

export const setTrainingLessonDone = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ lesson_id: z.string().uuid(), done: z.boolean() }).parse(d))
  .handler(async ({ context, data }) => {
    assertView(context);
    if (data.done) {
      const { data: lesson } = await supabaseAdmin.from("training_lessons").select("id")
        .eq("id", data.lesson_id).eq("user_id", context.ownerId).maybeSingle();
      if (!lesson) throw new Error("Aula não encontrada");
      const { error } = await supabaseAdmin.from("training_progress").upsert(
        { member_id: context.userId, lesson_id: data.lesson_id, user_id: context.ownerId },
        { onConflict: "member_id,lesson_id" },
      );
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin.from("training_progress").delete()
        .eq("member_id", context.userId).eq("lesson_id", data.lesson_id);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

// ── Progresso da equipe ──

export const getTrainingTeamProgress = createServerFn({ method: "GET" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ track_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    assertEdit(context);
    const ownerId = context.ownerId;
    const [{ data: lessons }, { data: members }] = await Promise.all([
      supabaseAdmin.from("training_lessons").select("id").eq("track_id", data.track_id).eq("user_id", ownerId),
      supabaseAdmin.from("workspace_members").select("member_id").eq("owner_id", ownerId),
    ]);
    const lessonIds = (lessons ?? []).map((l) => l.id);
    const people = [ownerId, ...(members ?? []).map((m) => m.member_id)];
    const [{ data: profiles }, { data: progress }] = await Promise.all([
      supabaseAdmin.from("profiles").select("id,full_name").in("id", people),
      lessonIds.length
        ? supabaseAdmin.from("training_progress").select("member_id,lesson_id,completed_at").in("lesson_id", lessonIds)
        : Promise.resolve({ data: [] as { member_id: string; lesson_id: string; completed_at: string }[] }),
    ]);
    const names = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
    return {
      total: lessonIds.length,
      people: people.map((id) => {
        const mine = (progress ?? []).filter((p) => p.member_id === id);
        const last = mine.reduce<string | null>((acc, p) => (!acc || p.completed_at > acc ? p.completed_at : acc), null);
        return { id, name: names.get(id) || "Sem nome", done: mine.map((p) => p.lesson_id), last };
      }),
    };
  });

// ── Arquivos (vídeos, PDFs, imagens dos documentos) ──

// Caminhos do bucket citados no conteúdo da aula (arquivo, vídeo enviado e
// imagens do documento, gravadas como "training://<caminho>").
function filePaths(content: Record<string, any> | null, ownerId: string): string[] {
  if (!content) return [];
  const out = new Set<string>();
  if (typeof content.path === "string") out.add(content.path);
  const raw = JSON.stringify(content);
  for (const m of raw.matchAll(/training:\/\/([^"\\]+)/g)) out.add(m[1]);
  return [...out].filter((p) => p.startsWith(`${ownerId}/`));
}

export const createTrainingUpload = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ name: z.string().min(1).max(255) }).parse(d))
  .handler(async ({ context, data }) => {
    assertEdit(context);
    const safe = data.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_").slice(-120);
    const path = `${context.ownerId}/${crypto.randomUUID()}-${safe}`;
    const { data: signed, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !signed) throw new Error(error?.message ?? "Não foi possível preparar o envio");
    return { path, token: signed.token };
  });

export const getTrainingFileUrl = createServerFn({ method: "POST" })
  .middleware([requireOwnerContext])
  .inputValidator((d) => z.object({ path: z.string().min(1).max(500), download: z.string().max(255).optional() }).parse(d))
  .handler(async ({ context, data }) => {
    assertView(context);
    if (!data.path.startsWith(`${context.ownerId}/`) || data.path.includes("..")) throw new Error("Arquivo não encontrado");
    const { data: signed, error } = await supabaseAdmin.storage.from(BUCKET)
      .createSignedUrl(data.path, 60 * 60 * 6, data.download ? { download: data.download } : undefined);
    if (error || !signed) throw new Error(error?.message ?? "Não foi possível gerar o link");
    return { url: signed.signedUrl };
  });
