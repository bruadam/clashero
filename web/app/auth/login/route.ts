import { auth0 } from "@/lib/auth0";

export async function GET() {
  return auth0.startInteractiveLogin({
    // Ensure Auth0 includes the org_id claim in the user profile.
    authorizationParameters: {
      scope: "openid profile email org_id",
    },
  });
}
