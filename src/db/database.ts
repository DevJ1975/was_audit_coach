/**
 * SQLite bootstrap: open the on-device database and run idempotent migrations.
 * This is the ONLY module that knows the physical schema. The local schema
 * mirrors the Supabase tables (Part 3) so Phase 4 sync is transport, not remodel.
 *
 * Reference/read-only library + scoping questions are bundled JSON (src/seed),
 * not stored here — only tenant/audit state lives in SQLite.
 */
import { Platform } from 'react-native';
import * as SQLite from 'expo-sqlite';

export type DB = SQLite.SQLiteDatabase;

const DB_NAME = 'soteria.db';
const SCHEMA_VERSION = 3;

let dbPromise: Promise<DB> | null = null;

/** Open (once) and migrate the database. Safe to await from many callers. */
export function getDatabase(): Promise<DB> {
  if (!dbPromise) {
    dbPromise = (async () => {
      await ensureSoleTabOwner();
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      try {
        await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
        await migrate(db);
      } catch (e) {
        // Don't leak the opened handle when a retry follows a failed migrate.
        await db.closeAsync().catch(() => {});
        throw e;
      }
      return db;
    })().catch((e) => {
      // Never cache a rejected open: leaving dbPromise holding the rejection
      // would replay this failure to every later caller for the life of the
      // JS context. Clearing it lets a retry (RepoProvider's button, or a
      // remount) attempt a genuinely fresh open.
      dbPromise = null;
      throw toStorageError(e);
    });
  }
  return dbPromise;
}

// ————— Web (OPFS) single-tab ownership —————————————————————————————————————
//
// On web, expo-sqlite persists via OPFS sync access handles, which are
// EXCLUSIVE per origin: only one tab can hold the database. Worse, if handle
// acquisition fails, expo-sqlite's worker is left permanently wedged (every
// later open throws "Invalid VFS state") — only a page reload recovers. So a
// second tab must be detected BEFORE the driver is touched: we claim a Web
// Lock for the life of the page, and a tab that can't get it fails fast with
// an actionable message while its worker is still healthy.

const TAB_LOCK_NAME = 'soteria.db.tab-owner';

const MULTI_TAB_MESSAGE =
  'Your audit database is open in another tab or window of this app ' +
  '(including an installed home-screen copy). Close every other copy, then reload this page.';

const ENGINE_FAILED_MESSAGE =
  'The on-device storage engine could not start. Fully close every tab and window of this app ' +
  '— or restart the browser — then reopen it.';

/** Minimal Web Locks surface — avoids depending on TS DOM lib types. */
interface WebLockManager {
  request(
    name: string,
    options: { ifAvailable: boolean },
    callback: (lock: object | null) => unknown,
  ): Promise<unknown>;
}

let tabLockHeld = false;

/** One ifAvailable grab of the tab lock. */
function tryAcquireTabLock(locks: WebLockManager): Promise<'acquired' | 'blocked' | 'error'> {
  return new Promise((resolve) => {
    locks
      .request(TAB_LOCK_NAME, { ifAvailable: true }, (lock) => {
        resolve(lock !== null ? 'acquired' : 'blocked');
        // Hold the lock until the page unloads (the browser releases it with
        // the OPFS handles) so sibling tabs fail fast instead of wedging.
        return lock ? new Promise<never>(() => {}) : undefined;
      })
      .catch(() => resolve('error')); // lock machinery failed — let the open proceed
  });
}

async function ensureSoleTabOwner(): Promise<void> {
  if (Platform.OS !== 'web' || tabLockHeld) return;
  const locks = (globalThis as { navigator?: { locks?: WebLockManager } }).navigator?.locks;
  if (!locks) return; // no Web Locks API — fall through to the driver's own error
  // On a fast reload the OLD page's lock can outlive the navigation by a
  // moment — retry briefly before declaring a second tab, or a plain refresh
  // intermittently shows the multi-tab error for a lock nobody holds anymore.
  let outcome = await tryAcquireTabLock(locks);
  for (let attempt = 0; outcome === 'blocked' && attempt < 4; attempt++) {
    await new Promise((r) => setTimeout(r, 350));
    outcome = await tryAcquireTabLock(locks);
  }
  if (outcome === 'blocked') {
    // Name the holder in the console so a field report can say WHICH context
    // owns the database (another tab's clientId) instead of us guessing.
    try {
      const q = await (locks as WebLockManager & { query?: () => Promise<{ held?: { name?: string; clientId?: string }[] }> })
        .query?.();
      const holders = (q?.held ?? []).filter((l) => l.name === TAB_LOCK_NAME).map((l) => l.clientId);
      console.error('[db] tab lock held by client(s):', holders.length ? holders : '(unknown)');
    } catch {
      // diagnostics only
    }
    throw new Error(MULTI_TAB_MESSAGE);
  }
  if (outcome === 'acquired') tabLockHeld = true;
}

/** Translate driver internals into operator-actionable messages. */
function toStorageError(e: unknown): Error {
  if (Platform.OS === 'web') {
    const text = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    // OPFS handle contention the lock couldn't see (stale worker from a
    // crashed page, non-Locks browser), or a worker already wedged by an
    // earlier failed open. Neither is recoverable without a reload.
    if (/InvalidStateError|invalid state|Invalid VFS state/i.test(text)) {
      // Keep the raw driver error findable for support; the UI shows guidance.
      console.error('[db] storage open failed:', text);
      return new Error(`${ENGINE_FAILED_MESSAGE}\n(${text})`);
    }
  }
  return e instanceof Error ? e : new Error(String(e));
}

async function addColumnIfMissing(db: DB, table: string, column: string, ddl: string): Promise<void> {
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table});`);
  if (!cols.some((c) => c.name === column)) {
    await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl};`);
  }
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
    await addColumnIfMissing(db, 'attachments', 'storage_path', 'TEXT');
    await addColumnIfMissing(db, 'attachments', 'sync_state', "TEXT NOT NULL DEFAULT 'local'");
    await addColumnIfMissing(db, 'attachments', 'deleted_at', 'TEXT');
  }

  // v3 — conflict resolution + server push cursors. `conflict_rating` holds
  // the PEER's divergent rating while an item is needs_resolution so the lead
  // auditor can compare and pick; `pushed` marks events/disclosures already
  // appended to the server's insert-only logs so each sync sends only the
  // delta (the disclosure log grows on every report view — unbounded re-push
  // otherwise).
  if (current < 3) {
    await addColumnIfMissing(db, 'audit_items', 'conflict_rating', 'TEXT');
    await addColumnIfMissing(db, 'audit_item_events', 'pushed', 'INTEGER NOT NULL DEFAULT 0');
    await addColumnIfMissing(db, 'disclosure_log', 'pushed', 'INTEGER NOT NULL DEFAULT 0');
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
