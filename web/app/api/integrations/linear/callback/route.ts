import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken, getOrganization } from "@/lib/linear";
import { auth0 } from "@/lib/auth0";
import { ensureOrganizationForAuth0Org, getLinearIntegration, saveLinearIntegration } from "@/lib/tenant-store";

const CLIENT_ID = process.env.LINEAR_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.LINEAR_CLIENT_SECRET ?? "";
const REDIRECT_URI =
  process.env.LINEAR_REDIRECT_URI ?? "http://localhost:3000/api/integrations/linear/callback";

export async function GET(req: NextRequest) {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return NextResponse.redirect(
      new URL("/app/settings/integrations/linear?error=missing_oauth_config", req.nextUrl.origin),
    );
  }
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const storedState = req.cookies.get("linear_oauth_state")?.value;

  if (!code) {
    return NextResponse.redirect(new URL("/app/settings/integrations/linear?error=no_code", req.nextUrl.origin));
  }

  if (!state || state !== storedState) {
    return NextResponse.redirect(
      new URL("/app/settings/integrations/linear?error=state_mismatch", req.nextUrl.origin),
    );
  }

  // Tenant comes from Auth0 session org_id. We don't accept an arbitrary org id cookie.
  const session = await auth0.getSession();
  const auth0OrgId = (session?.user as any)?.org_id as string | undefined;
  if (!auth0OrgId) {
    return NextResponse.redirect(new URL("/app/settings/integrations/linear?error=missing_tenant", req.nextUrl.origin));
  }

  const orgId = (await ensureOrganizationForAuth0Org(auth0OrgId)).id;

  try {
    const accessToken = await exchangeCodeForToken(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI, code);
    const org = await getOrganization(accessToken);
    const existing = await getLinearIntegration(orgId);

    await saveLinearIntegration(orgId, {
      accessToken,
      workspaceId: org.id,
      teamId: existing?.teamId ?? "",
      projectId: existing?.projectId ?? "",
    });

    const response = NextResponse.redirect(new URL("/app/settings/integrations/linear?connected=1", req.nextUrl.origin));
    response.cookies.delete("linear_oauth_state");
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const url = new URL("/app/settings/integrations/linear", req.nextUrl.origin);
    url.searchParams.set("error", encodeURIComponent(message));
    const response = NextResponse.redirect(url);
    response.cookies.delete("linear_oauth_state");
    return response;
  }
}
