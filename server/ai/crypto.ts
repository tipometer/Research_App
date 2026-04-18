import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "ENC1";
const IV_LENGTH = 12;    // 96 bits — NIST SP 800-38D recommended GCM IV
const TAG_LENGTH = 16;   // 128 bits — GCM standard
const KEY_LENGTH = 32;   // 256 bits — AES-256

// ─── Master key singleton ────────────────────────────────────────────────────

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

export function encrypt(plaintext: string, masterKey: Buffer, aad: string): string {
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
  const parts = stored.split(":");

  // Format guard: 4 segments required.
  // Defense-in-depth — also catches plaintext inputs that contain ':' chars
  // (e.g., accidental API-key-shaped inputs). Malformed base64 within segments
  // is NOT caught here (Node's Buffer.from silently returns garbage) — it
  // surfaces at decipher.final() auth-tag check and is wrapped by the catch
  // block below.
  if (parts.length !== 4) {
    throw new DecryptionError(
      `Invalid ciphertext format: expected 4 segments, got ${parts.length}`
    );
  }

  const [version, ivB64, ctB64, tagB64] = parts;

  if (version !== VERSION) {
    throw new DecryptionError(`Unsupported ciphertext version: ${version}`);
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
