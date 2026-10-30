/**
 * Encrypted envelope, browser side. CONTRACT — docs/CONTRACTS.md §5.2.
 * Byte-for-byte compatible with sync/src/Pacelab.Canonical/BundleCrypto.cs
 * (proven by fixtures/crypto/* and test/crypto.test.ts).
 *
 *   file      = "PLB1" (4 bytes) || iv (12) || ciphertext || tag (16)
 *   plaintext = gzip(UTF-8 JSON)
 *   key       = PBKDF2-HMAC-SHA256(passphrase UTF-8, salt, iterations, 32 bytes) -> AES-256-GCM, no AAD
 *
 * Phase 0 reference implementation. Owner after Phase 0: Track A.
 */
import { DEFAULT_PBKDF2_ITERATIONS, ENVELOPE_IV_BYTES, ENVELOPE_MAGIC, ENVELOPE_TAG_BYTES } from '@pacelab/schema';
import type { KeyInfo } from '@pacelab/schema';

export class WrongPassphraseError extends Error {
  constructor() {
    super('Wrong passphrase (or corrupted file)');
    this.name = 'WrongPassphraseError';
  }
}

const subtle = () => globalThis.crypto.subtle;

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function makeKeyInfo(iterations = DEFAULT_PBKDF2_ITERATIONS): KeyInfo {
  return { v: 1, kdf: 'PBKDF2-SHA256', iterations, salt: toBase64(globalThis.crypto.getRandomValues(new Uint8Array(16))) };
}

export async function deriveKey(passphrase: string, info: KeyInfo): Promise<CryptoKey> {
  if (info.v !== 1 || info.kdf !== 'PBKDF2-SHA256') throw new Error(`Unsupported key info ${info.v}/${info.kdf}`);
  const base = await subtle().importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(info.salt) as BufferSource, iterations: info.iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export async function encryptJson(key: CryptoKey, value: unknown, iv?: Uint8Array): Promise<Uint8Array> {
  const nonce = iv ?? globalThis.crypto.getRandomValues(new Uint8Array(ENVELOPE_IV_BYTES));
  const plain = await pipe(new TextEncoder().encode(JSON.stringify(value)), new CompressionStream('gzip'));
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, key, plain as BufferSource));
  const out = new Uint8Array(4 + ENVELOPE_IV_BYTES + ct.length);
  out.set(ENVELOPE_MAGIC, 0);
  out.set(nonce, 4);
  out.set(ct, 4 + ENVELOPE_IV_BYTES);
  return out;
}

export async function decryptJson<T = unknown>(key: CryptoKey, file: Uint8Array): Promise<T> {
  if (file.length < 4 + ENVELOPE_IV_BYTES + ENVELOPE_TAG_BYTES || ENVELOPE_MAGIC.some((b, i) => file[i] !== b)) {
    throw new Error('Not a Pacelab encrypted file (bad magic)');
  }
  const iv = file.subarray(4, 4 + ENVELOPE_IV_BYTES);
  let plain: Uint8Array;
  try {
    plain = new Uint8Array(
      await subtle().decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, file.subarray(4 + ENVELOPE_IV_BYTES) as BufferSource),
    );
  } catch {
    throw new WrongPassphraseError();
  }
  const json = new TextDecoder().decode(await pipe(plain, new DecompressionStream('gzip')));
  return JSON.parse(json) as T;
}
