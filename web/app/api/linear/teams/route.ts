import { NextResponse } from "next/server";
import { getLinearSettings } from "@/lib/db";
import { listTeams } from "@/lib/linear";

export async function GET() {
  const settings = getLinearSettings();
  if (!settings?.accessToken) {
    return NextResponse.json({ error: "Not connected to Linear" }, { status: 401 });
  }
  const teams = await listTeams(settings.accessToken);
  return NextResponse.json({ teams });
}
