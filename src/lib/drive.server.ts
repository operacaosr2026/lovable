// Google Drive só leitura, por chave de API (GOOGLE_API_KEY): enxerga apenas
// pastas/arquivos compartilhados como "Qualquer pessoa com o link".

const API = "https://www.googleapis.com/drive/v3";
export const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";

export type DriveLink = { kind: "folder" | "file" | "unknown"; id: string };

export function parseDriveLink(input: string): DriveLink | null {
  const s = input.trim();
  const folder = s.match(/\/folders\/([\w-]{10,})/);
  if (folder) return { kind: "folder", id: folder[1] };
  const file = s.match(/\/d\/([\w-]{10,})/);
  if (file) return { kind: "file", id: file[1] };
  const q = s.match(/[?&]id=([\w-]{10,})/);
  if (q) return { kind: "unknown", id: q[1] };
  if (/^[\w-]{20,}$/.test(s)) return { kind: "unknown", id: s };
  return null;
}

function key() {
  const k = process.env["GOOGLE_API_KEY"];
  if (!k) throw new Error("Chave do Google não configurada (GOOGLE_API_KEY)");
  return k;
}

const NOT_SHARED = "Não consegui abrir. Confira se o link está certo e se a pasta está compartilhada como \"Qualquer pessoa com o link\".";

export async function driveGet<T = any>(path: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams({ ...params, key: key(), supportsAllDrives: "true" });
  const res = await fetch(`${API}/${path}?${qs}`, { signal: AbortSignal.timeout(30_000) });
  const json: any = await res.json().catch(() => ({}));
  if (res.status === 404) throw new Error(NOT_SHARED);
  if (res.status === 403) {
    const reason = json?.error?.errors?.[0]?.reason ?? "";
    if (/accessNotConfigured|SERVICE_DISABLED/i.test(JSON.stringify(json))) throw new Error("A Google Drive API não está ativada no projeto da chave do Google.");
    if (/keyInvalid|API_KEY_INVALID/i.test(JSON.stringify(json))) throw new Error("A chave do Google é inválida.");
    throw new Error(reason === "forbidden" ? NOT_SHARED : json?.error?.message || "O Google recusou o acesso.");
  }
  if (!res.ok) throw new Error(json?.error?.message || `Google Drive respondeu ${res.status}`);
  return json as T;
}

export type DriveFile = {
  id: string; name: string; mimeType: string; size?: string; thumbnailLink?: string;
  videoMediaMetadata?: { width?: number; height?: number; durationMillis?: string };
  imageMediaMetadata?: { width?: number; height?: number };
};

const FILE_FIELDS = "id,name,mimeType,size,thumbnailLink,videoMediaMetadata(width,height,durationMillis),imageMediaMetadata(width,height)";

export async function driveFileMeta(id: string) {
  return driveGet<DriveFile>(`files/${id}`, { fields: FILE_FIELDS });
}

export async function driveListFolder(folderId: string) {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const r = await driveGet<{ files: DriveFile[]; nextPageToken?: string }>("files", {
      q: `'${folderId}' in parents and trashed=false`,
      fields: `nextPageToken,files(${FILE_FIELDS})`,
      orderBy: "folder,name",
      pageSize: "1000",
      includeItemsFromAllDrives: "true",
      ...(pageToken ? { pageToken } : {}),
    });
    files.push(...(r.files ?? []));
    pageToken = r.nextPageToken;
  } while (pageToken && files.length < 5000);
  return files;
}

export const driveViewUrl = (id: string) => `https://drive.google.com/file/d/${id}/view`;

// Link público de download (sem a chave): a Meta busca o vídeo direto por ele.
// confirm=t pula o aviso de "arquivo grande demais pra verificar vírus".
export const drivePublicDownloadUrl = (id: string) => `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;

export async function driveDownload(id: string): Promise<ArrayBuffer> {
  const qs = new URLSearchParams({ alt: "media", key: key(), supportsAllDrives: "true" });
  const res = await fetch(`${API}/files/${id}?${qs}`, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(res.status === 404 || res.status === 403 ? NOT_SHARED : `Não consegui baixar do Drive (${res.status})`);
  return res.arrayBuffer();
}

// Um pedaço do arquivo (bytes start..end-1), pra mandar vídeo à Meta em partes.
export async function driveDownloadRange(id: string, start: number, end: number): Promise<ArrayBuffer> {
  const qs = new URLSearchParams({ alt: "media", key: key(), supportsAllDrives: "true" });
  const res = await fetch(`${API}/files/${id}?${qs}`, { headers: { Range: `bytes=${start}-${end - 1}` }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok && res.status !== 206) throw new Error(res.status === 404 || res.status === 403 ? NOT_SHARED : `Não consegui ler o vídeo do Drive (${res.status})`);
  return res.arrayBuffer();
}

// Miniatura pequena do arquivo (vídeo ou imagem), ou null se o Drive ainda não gerou.
export async function driveThumbnail(file: Pick<DriveFile, "id" | "thumbnailLink">): Promise<{ bytes: ArrayBuffer; type: string } | null> {
  const urls = [
    file.thumbnailLink?.replace(/=s\d+$/, "=s720"),
    `https://drive.google.com/thumbnail?id=${file.id}&sz=w720`,
  ].filter(Boolean) as string[];
  for (const url of urls) {
    try {
      const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
      const type = res.headers.get("content-type") ?? "";
      if (res.ok && type.startsWith("image/")) return { bytes: await res.arrayBuffer(), type };
    } catch {
      // tenta a próxima
    }
  }
  return null;
}
