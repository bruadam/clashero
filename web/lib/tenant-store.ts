import crypto from "crypto";
import { getPgPool } from "@/lib/postgres";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

export type IntegrationProvider = "linear" | "dalux";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface LinearIntegration {
  accessToken: string;
  workspaceId: string;
  teamId: string;
  projectId: string;
}

export interface DaluxIntegration {
  apiKey: string;
  projectId: string;
  fileAreaId: string;
  folderId: string;
  folderPath: string;
}

interface IntegrationConnectionRecord {
  id: string;
  organization_id: string;
  provider: IntegrationProvider;
  status: string;
  secret: string | null;
  data: unknown;
  created_at: string;
  updated_at: string;
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    return JSON.parse(value) as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
}

export async function ensureDefaultOrganization(): Promise<Organization> {
  const pool = getPgPool();
  const existing = await pool.query<Organization>(
    "SELECT id, name, slug, created_at as \"createdAt\" FROM organizations WHERE slug = $1",
    ["default"],
  );
  if (existing.rows[0]) return existing.rows[0];

  const now = new Date().toISOString();
  const org: Organization = {
    id: crypto.randomUUID(),
    name: "Default Organization",
    slug: "default",
    createdAt: now,
  };

  await pool.query(
    "INSERT INTO organizations (id, name, slug, created_at) VALUES ($1, $2, $3, $4)",
    [org.id, org.name, org.slug, org.createdAt],
  );

  return org;
}

export async function ensureOrganizationForUser(userId: string, email?: string | null): Promise<Organization> {
  const pool = getPgPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const membership = await client.query<Organization>(
      `SELECT o.id, o.name, o.slug, o.created_at as "createdAt"
       FROM organization_memberships m
       JOIN organizations o ON o.id = m.organization_id
       WHERE m.user_id = $1
       ORDER BY m.created_at ASC
       LIMIT 1`,
      [userId],
    );

    if (membership.rows[0]) {
      await client.query("COMMIT");
      return membership.rows[0];
    }

    const now = new Date().toISOString();
    const orgId = crypto.randomUUID();
    const orgName = email ? `${email.split("@")[0]}'s workspace` : "Personal workspace";
    const slug = `org-${orgId.slice(0, 8)}`;

    await client.query(
      "INSERT INTO organizations (id, name, slug, created_at) VALUES ($1, $2, $3, $4)",
      [orgId, orgName, slug, now],
    );
    await client.query(
      "INSERT INTO organization_memberships (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, $4, $5)",
      [crypto.randomUUID(), orgId, userId, "owner", now],
    );

    await client.query("COMMIT");
    return { id: orgId, name: orgName, slug, createdAt: now };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getIntegrationRecord(
  organizationId: string,
  provider: IntegrationProvider,
): Promise<IntegrationConnectionRecord | null> {
  const pool = getPgPool();
  const result = await pool.query<IntegrationConnectionRecord>(
    "SELECT id, organization_id, provider, status, secret, data, created_at, updated_at FROM integration_connections WHERE organization_id = $1 AND provider = $2",
    [organizationId, provider],
  );
  return result.rows[0] ?? null;
}

async function upsertIntegrationConnection(options: {
  organizationId: string;
  provider: IntegrationProvider;
  status?: string;
  secret?: Record<string, string> | null;
  data?: Record<string, unknown>;
}): Promise<void> {
  const pool = getPgPool();
  const existing = await getIntegrationRecord(options.organizationId, options.provider);
  const now = new Date().toISOString();
  const id = existing?.id ?? crypto.randomUUID();
  const status = options.status ?? existing?.status ?? "connected";
  const secretPayload =
    options.secret === undefined
      ? existing?.secret ?? null
      : options.secret
        ? encryptSecret(JSON.stringify(options.secret))
        : null;
  const dataPayload = JSON.stringify(options.data ?? parseJsonRecord(existing?.data));

  await pool.query(
    `INSERT INTO integration_connections (id, organization_id, provider, status, secret, data, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
     ON CONFLICT (organization_id, provider)
     DO UPDATE SET status = EXCLUDED.status,
                   secret = EXCLUDED.secret,
                   data = EXCLUDED.data,
                   updated_at = EXCLUDED.updated_at`,
    [id, options.organizationId, options.provider, status, secretPayload, dataPayload, now],
  );
}

export async function getLinearIntegration(organizationId: string): Promise<LinearIntegration | null> {
  const record = await getIntegrationRecord(organizationId, "linear");
  if (!record?.secret) return null;
  const secret = JSON.parse(decryptSecret(record.secret)) as { accessToken?: string };
  if (!secret.accessToken) return null;
  const data = parseJsonRecord(record.data);
  return {
    accessToken: secret.accessToken,
    workspaceId: String(data.workspaceId ?? ""),
    teamId: String(data.teamId ?? ""),
    projectId: String(data.projectId ?? ""),
  };
}

export async function saveLinearIntegration(
  organizationId: string,
  settings: LinearIntegration,
): Promise<void> {
  await upsertIntegrationConnection({
    organizationId,
    provider: "linear",
    status: "connected",
    secret: { accessToken: settings.accessToken },
    data: {
      workspaceId: settings.workspaceId,
      teamId: settings.teamId,
      projectId: settings.projectId,
    },
  });
}

export async function getDaluxIntegration(organizationId: string): Promise<DaluxIntegration | null> {
  const record = await getIntegrationRecord(organizationId, "dalux");
  if (!record?.secret) return null;
  const secret = JSON.parse(decryptSecret(record.secret)) as { apiKey?: string };
  if (!secret.apiKey) return null;
  const data = parseJsonRecord(record.data);
  return {
    apiKey: secret.apiKey,
    projectId: String(data.projectId ?? ""),
    fileAreaId: String(data.fileAreaId ?? ""),
    folderId: String(data.folderId ?? ""),
    folderPath: String(data.folderPath ?? ""),
  };
}

export async function saveDaluxIntegration(
  organizationId: string,
  settings: DaluxIntegration,
): Promise<void> {
  await upsertIntegrationConnection({
    organizationId,
    provider: "dalux",
    status: "connected",
    secret: { apiKey: settings.apiKey },
    data: {
      projectId: settings.projectId,
      fileAreaId: settings.fileAreaId,
      folderId: settings.folderId,
      folderPath: settings.folderPath,
    },
  });
}

export async function clearIntegration(organizationId: string, provider: IntegrationProvider): Promise<void> {
  await upsertIntegrationConnection({
    organizationId,
    provider,
    status: "disconnected",
    secret: null,
    data: {},
  });
}
