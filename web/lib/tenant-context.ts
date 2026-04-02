import { auth0 } from "@/lib/auth0";
import { ensureOrganizationForAuth0Org } from "@/lib/tenant-store";

export async function getActiveOrganizationId(): Promise<string> {
  const session = await auth0.getSession();
  const orgId = (session?.user as any)?.org_id as string | undefined;
  if (!orgId) {
    throw new Error("Missing Auth0 org_id in session (tenant required)");
  }

  const org = await ensureOrganizationForAuth0Org(orgId);
  return org.id;
}
