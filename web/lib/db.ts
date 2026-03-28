/**
 * Lightweight JSON-file database for activity log and comments.
 * Stored at web/data/db.json — created on first write.
 * All operations are synchronous (fine for a local dev tool).
 */

import fs from "fs";
import path from "path";
import type { ActivityEntry, Comment } from "./types";

const DB_PATH = path.join(process.cwd(), "data", "db.json");

interface DbSchema {
  activity: ActivityEntry[];
  comments: Comment[];
}

function read(): DbSchema {
  try {
    const raw = fs.readFileSync(DB_PATH, "utf-8");
    return JSON.parse(raw) as DbSchema;
  } catch {
    return { activity: [], comments: [] };
  }
}

function write(db: DbSchema): void {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
}

// ── Activity ──────────────────────────────────────────────────────────────────

export function getActivity(clashGuid: string): ActivityEntry[] {
  const db = read();
  return db.activity
    .filter((e) => e.clashGuid === clashGuid)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export function addActivity(entry: Omit<ActivityEntry, "id">): ActivityEntry {
  const db = read();
  const full: ActivityEntry = { id: crypto.randomUUID(), ...entry };
  db.activity.push(full);
  write(db);
  return full;
}

// ── Comments ──────────────────────────────────────────────────────────────────

export function getComments(clashGuid: string): Comment[] {
  const db = read();
  return db.comments
    .filter((c) => c.clashGuid === clashGuid)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export function addComment(comment: Omit<Comment, "id">): Comment {
  const db = read();
  const full: Comment = { id: crypto.randomUUID(), ...comment };
  db.comments.push(full);
  write(db);
  return full;
}
