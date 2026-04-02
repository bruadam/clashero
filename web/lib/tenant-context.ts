import { auth } from "@/lib/auth";
import { ensureDefaultOrganization, ensureOrganizationForUser } from "@/lib/tenant-store";

export async function getActiveOrganizationId(): Promise<string> {
  try {
    const session = await auth();
    if (session?.user?.id) {
      const org = await ensureOrganizationForUser(session.user.id, session.user.email);
      return org.id;
    }
  } catch {
  }

  const org = await ensureDefaultOrganization();
  return org.id;
}
