import type { ReactNode } from "react";
import { auth0 } from "@/lib/auth0";
import { redirect } from "next/navigation";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await auth0.getSession();
  if (!session?.user) {
    redirect("/auth/login");
  }

  if (!(session.user as any).org_id) {
    // With Auth0 Organizations, org_id is required to resolve tenancy.
    redirect("/auth/login");
  }

  return <>{children}</>;
}
