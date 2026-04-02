import { auth0 } from "@/lib/auth0";

export async function GET(req: Request) {
  return auth0.middleware(req);
}
