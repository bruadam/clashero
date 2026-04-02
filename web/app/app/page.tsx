import Link from "next/link";
import { auth0 } from "@/lib/auth0";

export default async function AppHome() {
  const session = await auth0.getSession();
  const email = session?.user?.email;

  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Clashero</h1>
      <p className="text-sm text-muted-foreground">Signed in as {email ?? "unknown"}</p>

      <div className="flex gap-3">
        <Link className="underline" href="/app/settings/integrations/dalux">
          Dalux
        </Link>
        <Link className="underline" href="/app/settings/integrations/linear">
          Linear
        </Link>
        <Link className="underline" href="/auth/logout">
          Logout
        </Link>
      </div>
    </main>
  );
}

