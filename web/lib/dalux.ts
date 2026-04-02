const DEFAULT_DALUX_API_BASE = "https://box.dalux.com/api/v2";

export interface DaluxFolder {
  id: string;
  name: string;
}

export interface DaluxFile {
  id: string;
  name: string;
  latestRevisionId?: string;
}

interface DaluxFolderResponse {
  folders?: DaluxFolder[];
  files?: DaluxFile[];
  items?: Array<{ type: "folder" | "file"; id: string; name: string; latestRevisionId?: string }>;
}

function getDaluxBase(): string {
  return process.env.DALUX_API_BASE_URL ?? DEFAULT_DALUX_API_BASE;
}

async function daluxFetch<T>(apiKey: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getDaluxBase()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dalux API ${res.status}: ${text}`);
  }

  return (await res.json()) as T;
}

async function listFolderContents(
  apiKey: string,
  projectId: string,
  fileAreaId: string,
  folderId: string | null,
): Promise<{ folders: DaluxFolder[]; files: DaluxFile[] }> {
  const folderSegment = folderId ? `/folders/${folderId}` : "/folders/root";
  const response = await daluxFetch<DaluxFolderResponse>(
    apiKey,
    `/projects/${projectId}/fileareas/${fileAreaId}${folderSegment}`,
  );

  if (response.items) {
    return {
      folders: response.items.filter((i) => i.type === "folder").map((i) => ({ id: i.id, name: i.name })),
      files: response.items.filter((i) => i.type === "file").map((i) => ({ id: i.id, name: i.name, latestRevisionId: i.latestRevisionId })),
    };
  }

  return {
    folders: response.folders ?? [],
    files: response.files ?? [],
  };
}

export async function resolveDaluxFolderPath(
  apiKey: string,
  projectId: string,
  fileAreaId: string,
  folderPath: string,
): Promise<string> {
  const segments = folderPath.split("/").filter(Boolean);
  if (segments.length === 0) {
    return "root";
  }

  let currentFolderId: string | null = null;
  for (const segment of segments) {
    const { folders } = await listFolderContents(apiKey, projectId, fileAreaId, currentFolderId);
    const match = folders.find((folder) => folder.name.toLowerCase() === segment.toLowerCase());
    if (!match) {
      throw new Error(`Folder not found: ${segment}`);
    }
    currentFolderId = match.id;
  }

  return currentFolderId ?? "root";
}

export async function listDaluxIfcFiles(
  apiKey: string,
  projectId: string,
  fileAreaId: string,
  folderId: string,
): Promise<DaluxFile[]> {
  const { files } = await listFolderContents(apiKey, projectId, fileAreaId, folderId || null);
  return files.filter((file) => file.name.toLowerCase().endsWith(".ifc"));
}

export async function downloadLatestDaluxRevision(
  apiKey: string,
  projectId: string,
  fileAreaId: string,
  fileId: string,
): Promise<Response> {
  const res = await fetch(
    `${getDaluxBase()}/projects/${projectId}/fileareas/${fileAreaId}/files/${fileId}/revisions/latest/content`,
    {
      headers: { "X-API-KEY": apiKey },
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dalux content ${res.status}: ${text}`);
  }

  return res;
}
