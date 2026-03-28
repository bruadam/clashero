/**
 * Linear GraphQL API client.
 * Uses the Linear OAuth2 access token stored in linear_settings.
 */

const LINEAR_API = "https://api.linear.app/graphql";

export interface LinearOrganization {
  id: string;
  name: string;
  urlKey: string;
}

export interface LinearTeam {
  id: string;
  name: string;
  key: string;
}

export interface LinearProject {
  id: string;
  name: string;
}

export interface LinearIssue {
  id: string;
  identifier: string; // e.g. ENG-123
  title: string;
  description: string | null;
  url: string;
  state: { name: string };
  priority: number;
  assignee: { name: string } | null;
}

async function gql<T>(
  token: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(LINEAR_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Linear API HTTP ${res.status}: ${text}`);
  }

  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join(", "));
  }
  return json.data as T;
}

// ── OAuth ─────────────────────────────────────────────────────────────────────

export function buildOAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "read,write",
    state,
  });
  return `https://linear.app/oauth/authorize?${params}`;
}

export async function exchangeCodeForToken(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  code: string
): Promise<string> {
  const res = await fetch("https://api.linear.app/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

// ── Workspace / teams / projects ──────────────────────────────────────────────

export async function getOrganization(token: string): Promise<LinearOrganization> {
  const data = await gql<{ organization: LinearOrganization }>(
    token,
    `query { organization { id name urlKey } }`
  );
  return data.organization;
}

export async function listTeams(token: string): Promise<LinearTeam[]> {
  const data = await gql<{ teams: { nodes: LinearTeam[] } }>(
    token,
    `query { teams { nodes { id name key } } }`
  );
  return data.teams.nodes;
}

export async function listProjects(token: string, teamId: string): Promise<LinearProject[]> {
  const data = await gql<{ team: { projects: { nodes: LinearProject[] } } }>(
    token,
    `query($teamId: String!) {
       team(id: $teamId) {
         projects { nodes { id name } }
       }
     }`,
    { teamId }
  );
  return data.team.projects.nodes;
}

// ── Issues ────────────────────────────────────────────────────────────────────

/** Linear priority values: 0=none, 1=urgent, 2=high, 3=medium, 4=low */
const PRIORITY_MAP: Record<string, number> = {
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
  none: 0,
};

export async function createIssue(
  token: string,
  teamId: string,
  projectId: string | undefined,
  title: string,
  description: string,
  priority: string
): Promise<LinearIssue> {
  const data = await gql<{ issueCreate: { issue: LinearIssue } }>(
    token,
    `mutation CreateIssue($input: IssueCreateInput!) {
       issueCreate(input: $input) {
         issue {
           id identifier title description url
           state { name }
           priority
           assignee { name }
         }
       }
     }`,
    {
      input: {
        teamId,
        ...(projectId ? { projectId } : {}),
        title,
        description,
        priority: PRIORITY_MAP[priority] ?? 0,
      },
    }
  );
  return data.issueCreate.issue;
}

export async function getIssue(token: string, issueId: string): Promise<LinearIssue> {
  const data = await gql<{ issue: LinearIssue }>(
    token,
    `query($id: String!) {
       issue(id: $id) {
         id identifier title description url
         state { name }
         priority
         assignee { name }
       }
     }`,
    { id: issueId }
  );
  return data.issue;
}

export async function addAttachment(
  token: string,
  issueId: string,
  title: string,
  url: string,
  subtitle?: string
): Promise<{ id: string }> {
  const data = await gql<{ attachmentCreate: { attachment: { id: string } } }>(
    token,
    `mutation CreateAttachment($input: AttachmentCreateInput!) {
       attachmentCreate(input: $input) {
         attachment { id }
       }
     }`,
    {
      input: {
        issueId,
        title,
        url,
        ...(subtitle ? { subtitle } : {}),
      },
    }
  );
  return data.attachmentCreate.attachment;
}
