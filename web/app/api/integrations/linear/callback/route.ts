import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken, getOrganization } from "@/lib/linear";
import { ensureDefaultOrganization, getLinearIntegration, saveLinearIntegration } from "@/lib/tenant-store";

const CLIENT_ID = process.env.LINEAR_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.LINEAR_CLIENT_SECRET ?? "";
const REDIRECT_URI =
  process.env.LINEAR_REDIRECT_URI ?? "http://localhost:3000/api/integrations/linear/callback";

export async function GET(req: NextRequest) {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return NextResponse.redirect(new URL("/settings/integrations/linear?error=missing_oauth_config", req.nextUrl.origin));
  }
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const storedState = req.cookies.get("linear_oauth_state")?.value;

  if (!code) {
    return NextResponse.redirect(new URL("/settings/integrations/linear?error=no_code", req.nextUrl.origin));
  }

  if (!state || state !== storedState) {
    return NextResponse.redirect(new URL("/settings/integrations/linear?error=state_mismatch", req.nextUrl.origin));
  }

  const cookieOrgId = req.cookies.get("linear_oauth_org")?.value;
  const orgId = cookieOrgId ?? (await ensureDefaultOrganization()).id;

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

    const response = NextResponse.redirect(new URL("/settings/integrations/linear?connected=1", req.nextUrl.origin));
    response.cookies.delete("linear_oauth_state");
    response.cookies.delete("linear_oauth_org");
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const url = new URL("/settings/integrations/linear", req.nextUrl.origin);
    url.searchParams.set("error", encodeURIComponent(message));
    const response = NextResponse.redirect(url);
    response.cookies.delete("linear_oauth_state");
    response.cookies.delete("linear_oauth_org");
    return response;
  }
}
