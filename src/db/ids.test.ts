import { describe, it, expect } from 'vitest';
import { newId } from './ids';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newId', () => {
  it('mints RFC-4122 v4 UUIDs — the server schema types every PK uuid, so a non-UUID local id can never sync', () => {
    for (let i = 0; i < 50; i++) expect(newId()).toMatch(V4);
  });

  it('does not collide across a burst', () => {
    const seen = new Set(Array.from({ length: 5000 }, () => newId()));
    expect(seen.size).toBe(5000);
  });
});
