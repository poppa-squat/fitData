import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { KeyInfo } from '@pacelab/schema';
import { decryptJson, deriveKey, encryptJson, makeKeyInfo, WrongPassphraseError } from '../src/index.js';

const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const PASS = 'correct horse battery staple';

describe('encrypted envelope (docs/CONTRACTS.md §5.2)', () => {
  const keyInfo = JSON.parse(readFileSync(root('fixtures/crypto/keyinfo.json'), 'utf8')) as KeyInfo;
  const expected = JSON.parse(readFileSync(root('fixtures/canonical/swim-synthetic.json'), 'utf8'));

  it('decrypts the vector written by the C# BundleCrypto', async () => {
    const key = await deriveKey(PASS, keyInfo);
    const vector = new Uint8Array(readFileSync(root('fixtures/crypto/vector.enc')));
    expect(await decryptJson(key, vector)).toEqual(expected);
  });

  it('rejects a wrong passphrase with WrongPassphraseError', async () => {
    const key = await deriveKey('nope', keyInfo);
    const vector = new Uint8Array(readFileSync(root('fixtures/crypto/vector.enc')));
    await expect(decryptJson(key, vector)).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('decrypts the vector written by this TS implementation (C# side checks the same file)', async () => {
    const key = await deriveKey(PASS, keyInfo);
    const vector = new Uint8Array(readFileSync(root('fixtures/crypto/vector-ts.enc')));
    expect(await decryptJson(key, vector)).toEqual(expected);
  });

  it('round-trips with a fresh salt', async () => {
    const info = makeKeyInfo(1000);
    const key = await deriveKey(PASS, info);
    const enc = await encryptJson(key, { hello: [1, null, 2.5] });
    expect(Array.from(enc.subarray(0, 4))).toEqual([0x50, 0x4c, 0x42, 0x31]);
    expect(await decryptJson(key, enc)).toEqual({ hello: [1, null, 2.5] });
  });
});
