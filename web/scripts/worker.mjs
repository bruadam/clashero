import crypto from "crypto";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL not configured");
  process.exit(1);
}

const masterKey = process.env.CLASHERO_MASTER_KEY;
if (!masterKey) {
  console.error("CLASHERO_MASTER_KEY not configured");
  process.exit(1);
}

const pool = new Pool({ connectionString });

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const key = crypto.createHash("sha256").update(masterKey).digest();

function decryptSecret(payload) {
  const buffer = Buffer.from(payload, "base64");
  const iv = buffer.subarray(0, IV_LENGTH);
  const tag = buffer.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = buffer.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

async function loadDaluxConnections() {
  const result = await pool.query(
    "SELECT organization_id, secret, data FROM integration_connections WHERE provider = 'dalux' AND status = 'connected'",
  );
  return result.rows.map((row) => {
    const secret = row.secret ? JSON.parse(decryptSecret(row.secret)) : {};
    const data = typeof row.data === "string" ? JSON.parse(row.data) : row.data ?? {};
    return {
      organizationId: row.organization_id,
      apiKey: secret.apiKey,
      config: data,
    };
  });
}

async function run() {
  console.log("[worker] starting dalux poll");
  const daluxConnections = await loadDaluxConnections();

  for (const connection of daluxConnections) {
    console.log(`[worker] org ${connection.organizationId}: polling Dalux changes`);
    console.log("[worker] stub: enqueue clash run + Linear sync");
  }

  await pool.end();
  console.log("[worker] done");
}

run().catch((err) => {
  console.error("[worker] failed", err);
  process.exit(1);
});
