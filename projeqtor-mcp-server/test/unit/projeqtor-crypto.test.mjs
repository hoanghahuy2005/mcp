import test from 'node:test';
import assert from 'node:assert/strict';
import { decryptProjeqtorData, encryptProjeqtorData } from '../../dist/clients/projeqtor-crypto.js';

test('decrypts the upstream Chris Veness AES-CTR compatibility vector', () => {
  assert.equal(decryptProjeqtorData('lwGl66VVwVObKIr6of8HVqJr', 'pāşšŵōřđ', 256), 'big secret');
});

for (const bits of [128, 192, 256]) test(`ProjeQtOr AES-${bits} preserves UTF-8 JSON with the eight-byte nonce wire format`, () => {
  const plaintext = JSON.stringify({ name: 'Thiết kế cơ sở dữ liệu', description: 'Tiếng Việt' });
  const encrypted = encryptProjeqtorData(plaintext, '0123456789abcdef0123456789abcdef', bits,
    Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]));
  assert.deepEqual(Buffer.from(encrypted, 'base64').subarray(0, 8), Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));
  assert.equal(decryptProjeqtorData(encrypted, '0123456789abcdef0123456789abcdef', bits), plaintext);
  assert.ok(!encrypted.includes('Thiết kế'));
});
