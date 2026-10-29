import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export type AesKeyLength = 128 | 192 | 256;

function derivedKey(apiKey: string, bits: AesKeyLength): Buffer {
  const bytes = bits / 8;
  const password = Buffer.alloc(bytes);
  Buffer.from(apiKey, 'utf8').copy(password, 0, 0, bytes);
  const cipher = createCipheriv(`aes-${bits}-ecb`, password, null);
  cipher.setAutoPadding(false);
  const first = Buffer.concat([cipher.update(password.subarray(0, 16)), cipher.final()]);
  return Buffer.concat([first, first.subarray(0, bytes - 16)]);
}

function generatedNonce(now: number): Buffer {
  const nonce = Buffer.alloc(8);
  const milliseconds = now % 1000;
  const seconds = Math.floor(now / 1000);
  nonce.writeUInt16LE(milliseconds, 0);
  randomBytes(2).copy(nonce, 2);
  nonce.writeUInt32LE(seconds, 4);
  return nonce;
}

// ProjeQtOr uses the Chris Veness AES-CTR wire format: an eight-byte nonce
// prefix followed by AES-CTR ciphertext, with the complete value base64 encoded.
// Its password-to-key derivation is intentionally reproduced here rather than
// replaced with a standard KDF because api/index.php expects this exact format.
export function encryptProjeqtorData(plaintext: string, apiKey: string, bits: AesKeyLength,
  nonce: Uint8Array = generatedNonce(Date.now())): string {
  if (nonce.byteLength !== 8) throw new Error('ProjeQtOr AES nonce must contain eight bytes.');
  const prefix = Buffer.from(nonce);
  const counter = Buffer.concat([prefix, Buffer.alloc(8)]);
  const cipher = createCipheriv(`aes-${bits}-ctr`, derivedKey(apiKey, bits), counter);
  return Buffer.concat([prefix, cipher.update(plaintext, 'utf8'), cipher.final()]).toString('base64');
}

// Exported for compatibility tests and offline diagnostics only. Runtime writes
// need encryption; the upstream server owns decryption.
export function decryptProjeqtorData(ciphertext: string, apiKey: string, bits: AesKeyLength): string {
  const bytes = Buffer.from(ciphertext, 'base64');
  if (bytes.length < 8) throw new Error('Invalid ProjeQtOr AES ciphertext.');
  const counter = Buffer.concat([bytes.subarray(0, 8), Buffer.alloc(8)]);
  const decipher = createDecipheriv(`aes-${bits}-ctr`, derivedKey(apiKey, bits), counter);
  return Buffer.concat([decipher.update(bytes.subarray(8)), decipher.final()]).toString('utf8');
}
