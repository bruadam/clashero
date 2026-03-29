import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken, getOrganization } from "@/lib/linear";
import { saveLinearSettings, getLinearSettings } from "@/lib/db";

const CLIENT_ID = process.env.LINEAR_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.LINEAR_CLIENT_SECRET ?? "";
const REDIRECT_URI = process.env.LINEAR_REDIRECT_URI ?? "http://localhost:3000/api/linear/callback";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const storedState = req.cookies.get("linear_oauth_state")?.value;

  if (!code) {
    return NextResponse.redirect(new URL("/settings/linear?error=no_code", req.nextUrl.origin));
  }

  if (!state || state !== storedState) {
    return NextResponse.redirect(new URL("/settings/linear?error=state_mismatch", req.nextUrl.origin));
  }

  try {
    const accessToken = await exchangeCodeForToken(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI, code);
    const org = await getOrganization(accessToken);

    const existing = await getLinearSettings();
    await saveLinearSettings({
      accessToken,
      workspaceId: org.id,
      teamId: existing?.teamId ?? "",
      projectId: existing?.projectId ?? "",
    });

    const response = NextResponse.redirect(new URL("/settings/linear?connected=1", req.nextUrl.origin));
    response.cookies.delete("linear_oauth_state");
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const url = new URL("/settings/linear", req.nextUrl.origin);
    url.searchParams.set("error", encodeURIComponent(message));
    return NextResponse.redirect(url);
  }
}
