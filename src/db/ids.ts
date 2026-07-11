/**
 * Local id + timestamp helpers. Ids are for on-device uniqueness only (not
 * security-sensitive); Postgres/PowerSync own global identity in Phase 4.
 */
let counter = 0;

export function newId(): string {
  counter = (counter + 1) % 0xffff;
  const t = Date.now().toString(36);
  const r = Math.floor(Math.random() * 0xffffff).toString(36);
  return `${t}-${counter.toString(36)}-${r}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
