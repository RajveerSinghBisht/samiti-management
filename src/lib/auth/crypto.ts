import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Secret, TOTP } from 'otpauth';
import QRCode from 'qrcode';

const BCRYPT_ROUNDS = 10;
const DUMMY_BCRYPT_HASH = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

/**
 * Combines a user secret (PIN or password) with the environment pepper via HMAC-SHA256
 * so the resulting digest is fixed-length (44 base64 chars, well below bcrypt's 72-byte limit).
 */
function applyPepper(secret: string, pepper: string): string {
  return crypto.createHmac('sha256', pepper).update(secret, 'utf8').digest('base64');
}

export function validatePinFormat(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

export function validateAdminPasswordFormat(password: string): boolean {
  return typeof password === 'string' && password.length >= 12 && password.length <= 128;
}

export async function hashPin(pin: string, pepper: string): Promise<string> {
  if (!validatePinFormat(pin)) {
    throw new Error('PIN must be 4 to 6 digits');
  }
  return bcrypt.hash(applyPepper(pin, pepper), BCRYPT_ROUNDS);
}

export async function verifyPin(pin: string, hash: string, pepper: string): Promise<boolean> {
  if (!validatePinFormat(pin)) {
    await bcrypt.compare(applyPepper('0000', pepper), DUMMY_BCRYPT_HASH);
    return false;
  }
  return bcrypt.compare(applyPepper(pin, pepper), hash);
}

export async function hashPassword(password: string, pepper: string): Promise<string> {
  if (!validateAdminPasswordFormat(password)) {
    throw new Error('Admin password must be at least 12 characters');
  }
  return bcrypt.hash(applyPepper(password, pepper), BCRYPT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  hash: string,
  pepper: string
): Promise<boolean> {
  if (typeof password !== 'string' || password.length === 0) {
    await bcrypt.compare(applyPepper('dummy-password-check', pepper), DUMMY_BCRYPT_HASH);
    return false;
  }
  return bcrypt.compare(applyPepper(password, pepper), hash);
}

export async function dummySecretCheck(pepper: string): Promise<void> {
  await bcrypt.compare(applyPepper('dummy-secret-check', pepper), DUMMY_BCRYPT_HASH);
}

export function generateRandomToken(byteLength = 32): string {
  return crypto.randomBytes(byteLength).toString('base64url');
}

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function encryptTotpSecret(base32Secret: string, hexKey: string): string {
  const key = Buffer.from(hexKey, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  const encrypted = Buffer.concat([cipher.update(base32Secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptTotpSecret(payload: string, hexKey: string): string {
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted TOTP secret');
  }
  const [ivB64, tagB64, dataB64] = parts;
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed encrypted TOTP secret');
  }
  const key = Buffer.from(hexKey, 'hex');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  if (iv.length !== 12 || tag.length !== 16) {
    throw new Error('Malformed encrypted TOTP secret parameters');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function generateTotpSecret(label: string): {
  base32: string;
  otpauthUrl: string;
} {
  const secret = new Secret({ size: 20 });
  const totp = new TOTP({
    issuer: 'Samiti',
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret,
  });
  return {
    base32: secret.base32,
    otpauthUrl: totp.toString(),
  };
}

export async function generateQrDataUrl(otpauthUrl: string): Promise<string> {
  return QRCode.toDataURL(otpauthUrl, { width: 220, margin: 1 });
}

export function verifyTotpCode(base32Secret: string, code: string): boolean {
  const clean = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return false;
  const totp = new TOTP({
    issuer: 'Samiti',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(base32Secret),
  });
  const delta = totp.validate({ token: clean, window: 1 });
  return delta !== null;
}

export function generateRecoveryCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5, 10)}`);
  }
  return codes;
}

export function hashRecoveryCode(code: string, pepper: string): string {
  const normalized = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return crypto.createHmac('sha256', pepper).update(normalized, 'utf8').digest('hex');
}

