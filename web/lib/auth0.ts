import { Auth0Client } from "@auth0/nextjs-auth0/server";

function envOrDummy(name: string): string {
  return process.env[name] ?? `__MISSING_${name}__`;
}

export const auth0 = new Auth0Client({
  domain: envOrDummy("AUTH0_DOMAIN"),
  clientId: envOrDummy("AUTH0_CLIENT_ID"),
  clientSecret: envOrDummy("AUTH0_CLIENT_SECRET"),
  secret: envOrDummy("AUTH0_SECRET"),
  appBaseUrl: process.env.AUTH0_BASE_URL ?? process.env.APP_BASE_URL,
});

