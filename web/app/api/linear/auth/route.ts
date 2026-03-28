import { NextResponse } from "next/server";
import { buildOAuthUrl } from "@/lib/linear";

const CLIENT_ID = process.env.LINEAR_CLIENT_ID ?? "";
const REDIRECT_URI = process.env.LINEAR_REDIRECT_URI ?? "http://localhost:3000/api/linear/callback";

export async function GET() {
  if (!CLIENT_ID) {
    return NextResponse.json(
      { error: "LINEAR_CLIENT_ID not configured" },
      { status: 500 }
    );
  }

  const state = crypto.randomUUID();
  const url = buildOAuthUrl(CLIENT_ID, REDIRECT_URI, state);

  const response = NextResponse.redirect(url);
  // Store state in a short-lived cookie for CSRF verification
  response.cookies.set("linear_oauth_state", state, {
    httpOnly: true,
    maxAge: 600,
    path: "/",
  });
  return response;
}
