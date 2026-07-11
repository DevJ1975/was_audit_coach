/**
 * Local id + timestamp helpers.
 *
 * Ids are RFC-4122 v4 UUIDs: the server schema (Part 3) types every primary key
 * `uuid`, and Phase 4 sync pushes locally minted ids straight into those
 * columns — a non-UUID local id makes every row permanently unsyncable
 * ("invalid input syntax for type uuid"). Entropy: native crypto.randomUUID /
 * getRandomValues where the runtime provides them (web, Node); Math.random
 * batches otherwise (Hermes) — statistically fine for uniqueness, and these ids
 * are not security tokens.
 */

type CryptoLike = {
  randomUUID?: () => string;
  getRandomValues?: (buf: Uint8Array) => Uint8Array;
};

const HEX: string[] = [];
for (let i = 0; i < 256; i++) HEX.push((i + 0x100).toString(16).slice(1));

function bytesToUuid(b: Uint8Array): string {
  return (
    HEX[b[0]!]! + HEX[b[1]!]! + HEX[b[2]!]! + HEX[b[3]!]! + '-' +
    HEX[b[4]!]! + HEX[b[5]!]! + '-' +
    HEX[b[6]!]! + HEX[b[7]!]! + '-' +
    HEX[b[8]!]! + HEX[b[9]!]! + '-' +
    HEX[b[10]!]! + HEX[b[11]!]! + HEX[b[12]!]! + HEX[b[13]!]! + HEX[b[14]!]! + HEX[b[15]!]!
  );
}

export function newId(): string {
  const c = (globalThis as { crypto?: CryptoLike }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) {
    c.getRandomValues(b);
  } else {
    for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  }
  b[6] = (b[6]! & 0x0f) | 0x40; // version 4
  b[8] = (b[8]! & 0x3f) | 0x80; // variant 10xx
  return bytesToUuid(b);
}

export function nowIso(): string {
  return new Date().toISOString();
}
