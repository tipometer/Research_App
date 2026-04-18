import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "ENC1";
const IV_LENGTH = 12;    // 96 bits — NIST SP 800-38D recommended GCM IV
const TAG_LENGTH = 16;   // 128 bits — GCM standard
const KEY_LENGTH = 32;   // 256 bits — AES-256

// Standard base64 alphabet with optional 0-2 trailing '=' padding chars.
// Used as a cheap sanity check on ciphertext segments — Node's Buffer.from(x,
// "base64") silently returns garbage bytes on invalid input rather than
// throwing, so we match the charset explicitly at the format-guard layer.
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

// ─── Master key singleton ────────────────────────────────────────────────────

/**
 * Process-global singleton. Persists for the lifetime of the Node process.
 *
 * Key rotation requires a process restart — changing MASTER_ENCRYPTION_KEY at
 * runtime does NOT re-read the env var. In tests, use __resetMasterKeyForTesting()
 * to clear the cache between assertions.
 */
let cachedMasterKey: Buffer | null = null;

export function getMasterKey(): Buffer {
  if (cachedMasterKey) return cachedMasterKey;

  const encoded = process.env.MASTER_ENCRYPTION_KEY;
  if (!encoded) {
    throw new Error(
      "MASTER_ENCRYPTION_KEY env var not set. " +
      "Generate one with: openssl rand -base64 32"
    );
  }

  const decoded = Buffer.from(encoded, "base64");
  if (decoded.length !== KEY_LENGTH) {
    throw new Error(
      `MASTER_ENCRYPTION_KEY must be ${KEY_LENGTH} bytes (got ${decoded.length})`
    );
  }

  cachedMasterKey = decoded;
  return cachedMasterKey;
}

/**
 * Test-only: resets the singleton so different tests can set different env values.
 * Throws in production to prevent accidental use.
 */
export function __resetMasterKeyForTesting(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("__resetMasterKeyForTesting must not be called in production");
  }
  cachedMasterKey = null;
}

// ─── DecryptionError ─────────────────────────────────────────────────────────

export class DecryptionError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "DecryptionError";
  }
}

// ─── Encrypt / decrypt ────────────────────────────────────────────────────────

/**
 * Defense-in-depth guard. Symmetric with the env-time validation in
 * getMasterKey() — catches callers that bypass the singleton and pass a
 * wrong-length Buffer. Throws a PLAIN Error (not DecryptionError): this is a
 * programmer / config bug, not a ciphertext problem, and should not be
 * classified as a non-eligible decryption failure by the fallback classifier.
 */
function assertValidKeyLength(masterKey: Buffer): void {
  if (masterKey.length !== KEY_LENGTH) {
    throw new Error(
      `Invalid master key length: expected ${KEY_LENGTH} bytes, got ${masterKey.length}`
    );
  }
}

export function encrypt(plaintext: string, masterKey: Buffer, aad: string): string {
  assertValidKeyLength(masterKey);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
  cipher.setAAD(Buffer.from(aad, "utf-8"));

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `${VERSION}:${iv.toString("base64")}:${ciphertext.toString("base64")}:${tag.toString("base64")}`;
}

export function decrypt(stored: string, masterKey: Buffer, aad: string): string {
  assertValidKeyLength(masterKey);
  const parts = stored.split(":");

  // Format guard: 4 segments required.
  // Defense-in-depth — also catches plaintext inputs that contain ':' chars
  // (e.g., accidental API-key-shaped inputs).
  if (parts.length !== 4) {
    throw new DecryptionError(
      `Invalid ciphertext format: expected 4 segments, got ${parts.length}`
    );
  }

  const [version, ivB64, ctB64, tagB64] = parts;

  if (version !== VERSION) {
    throw new DecryptionError(`Unsupported ciphertext version: ${version}`);
  }

  // Base64 sanity check: Node's Buffer.from(x, "base64") silently accepts
  // invalid input and returns garbage bytes. Without this guard, malformed
  // ciphertext would defer its failure to the decipher.final() auth-tag check
  // and surface with a generic "corrupted ciphertext" message. Matching the
  // standard base64 charset up-front gives a specific, actionable error.
  for (const [name, seg] of [
    ["iv", ivB64],
    ["ciphertext", ctB64],
    ["tag", tagB64],
  ] as const) {
    if (!BASE64_RE.test(seg)) {
      throw new DecryptionError(`Malformed base64 in ${name} segment`);
    }
  }

  try {
    const iv = Buffer.from(ivB64, "base64");
    const ciphertext = Buffer.from(ctB64, "base64");
    const tag = Buffer.from(tagB64, "base64");

    if (iv.length !== IV_LENGTH) {
      throw new DecryptionError(`Invalid IV length: ${iv.length}`);
    }
    if (tag.length !== TAG_LENGTH) {
      throw new DecryptionError(`Invalid tag length: ${tag.length}`);
    }

    const decipher = createDecipheriv("aes-256-gcm", masterKey, iv);
    decipher.setAAD(Buffer.from(aad, "utf-8"));
    decipher.setAuthTag(tag);

    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return plaintext.toString("utf-8");
  } catch (err) {
    if (err instanceof DecryptionError) throw err;
    // Node's crypto throws a generic Error for auth failure or malformed input.
    // Wrap it so callers (e.g., fallback classifier) can use `instanceof DecryptionError`.
    throw new DecryptionError(
      "Decryption failed (auth tag mismatch or corrupted ciphertext)",
      err,
    );
  }
}
