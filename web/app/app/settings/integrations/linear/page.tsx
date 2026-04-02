import { Suspense } from "react";
import { LinearIntegrationSettings } from "@/components/integrations/linear-settings";

export default function LinearIntegrationPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}>
      <LinearIntegrationSettings />
    </Suspense>
  );
}
