// Railway (and many PaaS) require binding to 0.0.0.0 on the provided PORT.
// Next.js "standalone" output ships its own server entrypoint.

process.env.HOSTNAME = process.env.HOSTNAME || "0.0.0.0";
process.env.PORT = process.env.PORT || "8080";

// eslint-disable-next-line @typescript-eslint/no-var-requires
require("./.next/standalone/server.js");

