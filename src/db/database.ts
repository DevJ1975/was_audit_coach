/**
 * SQLite bootstrap: open the on-device database and run idempotent migrations.
 * This is the ONLY module that knows the physical schema. The local schema
 * mirrors the Supabase tables (Part 3) so Phase 4 sync is transport, not remodel.
 *
 * Reference/read-only library + scoping questions are bundled JSON (src/seed),
 * not stored here — only tenant/audit state lives in SQLite.
 */
import * as SQLite from 'expo-sqlite';

export type DB = SQLite.SQLiteDatabase;

const DB_NAME = 'soteria.db';
const SCHEMA_VERSION = 2;

let dbPromise: Promise<DB> | null = null;

/** Open (once) and migrate the database. Safe to await from many callers. */
export function getDatabase(): Promise<DB> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
      await migrate(db);
      return db;
    })();
  }
  return dbPromise;
}

async function migrate(db: DB): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
  const current = row?.user_version ?? 0;
  if (current >= SCHEMA_VERSION) return;

  // v1 — baseline schema (tenant/audit state; the library is bundled JSON).
  if (current < 1) await db.execAsync(`
    CREATE TABLE IF NOT EXISTS audits (
      id TEXT PRIMARY KEY NOT NULL,
      org_id TEXT NOT NULL,
      facility_id TEXT,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      privileged INTEGER NOT NULL DEFAULT 0,
      attorney_of_record TEXT,
      state_plan TEXT,
      library_version_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scoping_answers (
      audit_id TEXT NOT NULL,
      org_id TEXT NOT NULL,
      question_key TEXT NOT NULL,
      answer INTEGER NOT NULL,
      PRIMARY KEY (audit_id, question_key)
    );

    CREATE TABLE IF NOT EXISTS audit_items (
      id TEXT PRIMARY KEY NOT NULL,
      org_id TEXT NOT NULL,
      audit_id TEXT NOT NULL,
      item_code TEXT NOT NULL,
      section_code TEXT NOT NULL,
      applicable INTEGER NOT NULL DEFAULT 1,
      rating TEXT,
      observations TEXT NOT NULL DEFAULT '',
      recommendations TEXT NOT NULL DEFAULT '',
      auditor_notes TEXT NOT NULL DEFAULT '',
      ai_generated INTEGER NOT NULL DEFAULT 0,
      sync_state TEXT NOT NULL DEFAULT 'local',
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_items_audit ON audit_items(audit_id);

    CREATE TABLE IF NOT EXISTS audit_item_events (
      id TEXT PRIMARY KEY NOT NULL,
      org_id TEXT NOT NULL,
      audit_id TEXT NOT NULL,
      audit_item_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_item ON audit_item_events(audit_item_id);
    CREATE INDEX IF NOT EXISTS idx_events_audit ON audit_item_events(audit_id);

    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY NOT NULL,
      org_id TEXT NOT NULL,
      audit_item_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      uri TEXT NOT NULL,
      transcription TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_attachments_item ON attachments(audit_item_id);

    CREATE TABLE IF NOT EXISTS corrective_actions (
      id TEXT PRIMARY KEY NOT NULL,
      org_id TEXT NOT NULL,
      audit_id TEXT NOT NULL,
      audit_item_id TEXT NOT NULL,
      rating TEXT NOT NULL,
      assigned_to TEXT,
      due_date TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      verified_by TEXT,
      close_date TEXT,
      closure_evidence_attachment_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ca_audit ON corrective_actions(audit_id);

    CREATE TABLE IF NOT EXISTS disclosure_log (
      id TEXT PRIMARY KEY NOT NULL,
      org_id TEXT NOT NULL,
      audit_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_disclosure_audit ON disclosure_log(audit_id);
  `);

  // v2 — evidence upload sync. Track the Storage object path + upload state, and
  // a removal tombstone, on attachments. Added via ALTER (not baked into the v1
  // CREATE) so a device already on v1 converges to the same shape as a fresh
  // install. Existing local rows default to 'local' = pending upload, which is
  // exactly right: they were captured offline and never reached Storage.
  if (current < 2) {
    await db.execAsync(`
      ALTER TABLE attachments ADD COLUMN storage_path TEXT;
      ALTER TABLE attachments ADD COLUMN sync_state TEXT NOT NULL DEFAULT 'local';
      ALTER TABLE attachments ADD COLUMN deleted_at TEXT;
    `);
  }

  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
}

/** Test/dev helper — drop everything (never call in production flows). */
export async function resetDatabase(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(`
    DELETE FROM disclosure_log;
    DELETE FROM corrective_actions;
    DELETE FROM attachments;
    DELETE FROM audit_item_events;
    DELETE FROM audit_items;
    DELETE FROM scoping_answers;
    DELETE FROM audits;
  `);
}
