import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  encrypt,
  decrypt,
  getMasterKey,
  __resetMasterKeyForTesting,
  DecryptionError,
} from "./crypto";

const TEST_KEY_B64 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="; // 32 zero bytes base64
const AAD = "aiConfig:openai";

describe("crypto — master key singleton", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.MASTER_ENCRYPTION_KEY;
    __resetMasterKeyForTesting();
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.MASTER_ENCRYPTION_KEY;
    else process.env.MASTER_ENCRYPTION_KEY = originalEnv;
    __resetMasterKeyForTesting();
  });

  it("returns 32-byte buffer when env is set", () => {
    process.env.MASTER_ENCRYPTION_KEY = TEST_KEY_B64;
    const key = getMasterKey();
    expect(key.length).toBe(32);
  });

  it("returns same Buffer reference on repeat calls (singleton)", () => {
    process.env.MASTER_ENCRYPTION_KEY = TEST_KEY_B64;
    const k1 = getMasterKey();
    const k2 = getMasterKey();
    expect(k1).toBe(k2);
  });

  it("throws when env var is missing", () => {
    delete process.env.MASTER_ENCRYPTION_KEY;
    expect(() => getMasterKey()).toThrow(/MASTER_ENCRYPTION_KEY/);
  });

  it("throws when env var decodes to wrong length", () => {
    process.env.MASTER_ENCRYPTION_KEY = Buffer.from("short").toString("base64"); // 5 bytes
    expect(() => getMasterKey()).toThrow(/32 bytes/);
  });

  it("__resetMasterKeyForTesting throws in production", () => {
    const origNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(() => __resetMasterKeyForTesting()).toThrow(/production/);
    } finally {
      process.env.NODE_ENV = origNodeEnv;
    }
  });
});

describe("crypto — encrypt/decrypt round-trip", () => {
  const key = Buffer.alloc(32, 0); // 32 zero bytes

  it("round-trips plaintext", () => {
    const pt = "sk-ant-api03-abc123xyz";
    const ct = encrypt(pt, key, AAD);
    expect(decrypt(ct, key, AAD)).toBe(pt);
  });

  it("produces non-deterministic ciphertext (random IV)", () => {
    const pt = "same plaintext";
    const ct1 = encrypt(pt, key, AAD);
    const ct2 = encrypt(pt, key, AAD);
    expect(ct1).not.toBe(ct2);
  });

  it("ciphertext starts with ENC1: version prefix", () => {
    const ct = encrypt("x", key, AAD);
    expect(ct.startsWith("ENC1:")).toBe(true);
  });

  it("ciphertext has 4 colon-separated segments", () => {
    const ct = encrypt("x", key, AAD);
    expect(ct.split(":").length).toBe(4);
  });
});

describe("crypto — tamper detection", () => {
  const key = Buffer.alloc(32, 0);

  it("DecryptionError when ciphertext bytes are modified", () => {
    const ct = encrypt("hello", key, AAD);
    const parts = ct.split(":");
    const ctBuf = Buffer.from(parts[2], "base64");
    ctBuf[0] = ctBuf[0] ^ 0xff; // flip first byte
    parts[2] = ctBuf.toString("base64");
    const tampered = parts.join(":");
    expect(() => decrypt(tampered, key, AAD)).toThrow(DecryptionError);
  });

  it("DecryptionError when tag is modified", () => {
    const ct = encrypt("hello", key, AAD);
    const parts = ct.split(":");
    const tagBuf = Buffer.from(parts[3], "base64");
    tagBuf[0] = tagBuf[0] ^ 0xff;
    parts[3] = tagBuf.toString("base64");
    const tampered = parts.join(":");
    expect(() => decrypt(tampered, key, AAD)).toThrow(DecryptionError);
  });

  it("DecryptionError when IV is modified", () => {
    const ct = encrypt("hello", key, AAD);
    const parts = ct.split(":");
    const ivBuf = Buffer.from(parts[1], "base64");
    ivBuf[0] = ivBuf[0] ^ 0xff;
    parts[1] = ivBuf.toString("base64");
    const tampered = parts.join(":");
    expect(() => decrypt(tampered, key, AAD)).toThrow(DecryptionError);
  });

  it("DecryptionError when AAD differs from encrypt-time AAD", () => {
    const ct = encrypt("hello", key, "aiConfig:openai");
    expect(() => decrypt(ct, key, "aiConfig:anthropic")).toThrow(DecryptionError);
  });
});

describe("crypto — format + version guards", () => {
  const key = Buffer.alloc(32, 0);

  it("DecryptionError when segment count != 4 (plaintext with colons)", () => {
    // Plaintext that happens to contain a colon — simulates an API key leaking into decrypt path
    expect(() => decrypt("sk-ant-api03-xyz:abc", key, AAD)).toThrow(DecryptionError);
  });

  it("DecryptionError when only two segments", () => {
    expect(() => decrypt("ENC1:onlytwo", key, AAD)).toThrow(DecryptionError);
  });

  it("DecryptionError when version prefix is not ENC1", () => {
    const ct = encrypt("hello", key, AAD);
    const parts = ct.split(":");
    parts[0] = "ENC2";
    expect(() => decrypt(parts.join(":"), key, AAD)).toThrow(DecryptionError);
  });

  it("DecryptionError when base64 segment is invalid", () => {
    // Node's Buffer.from("!!!", "base64") does NOT throw — it returns a garbage
    // buffer. The BASE64_RE format-guard now catches this up-front (see
    // "crypto — base64 sanity check (C2b-fix)" below). This test still asserts
    // the net behavior: invalid base64 → DecryptionError.
    expect(() => decrypt("ENC1:!!!:ct:tag", key, AAD)).toThrow(DecryptionError);
  });
});

describe("crypto — key length guard (C2b-fix)", () => {
  it("encrypt throws plain Error on wrong-length masterKey", () => {
    const shortKey = Buffer.alloc(16, 0); // 128 bits instead of 256
    expect(() => encrypt("hello", shortKey, "aad")).toThrow(/Invalid master key length/);
    // Plain Error, NOT DecryptionError — programmer error, not ciphertext issue.
    expect(() => encrypt("hello", shortKey, "aad")).not.toThrow(DecryptionError);
  });

  it("decrypt throws plain Error on wrong-length masterKey", () => {
    const shortKey = Buffer.alloc(16, 0);
    expect(() => decrypt("ENC1:AAA=:BBB=:CCC=", shortKey, "aad")).toThrow(
      /Invalid master key length/,
    );
    expect(() => decrypt("ENC1:AAA=:BBB=:CCC=", shortKey, "aad")).not.toThrow(
      DecryptionError,
    );
  });
});

describe("crypto — base64 sanity check (C2b-fix)", () => {
  const key = Buffer.alloc(32, 0);

  it("DecryptionError with specific message for malformed base64 in iv segment", () => {
    expect(() =>
      decrypt("ENC1:!!!:AAAA:AAAAAAAAAAAAAAAAAAAAAA==", key, AAD),
    ).toThrow(/Malformed base64 in iv/);
  });

  it("DecryptionError with specific message for malformed base64 in ciphertext segment", () => {
    expect(() =>
      decrypt(
        "ENC1:AAAAAAAAAAAAAAAA:!!!:AAAAAAAAAAAAAAAAAAAAAA==",
        key,
        AAD,
      ),
    ).toThrow(/Malformed base64 in ciphertext/);
  });

  it("DecryptionError with specific message for malformed base64 in tag segment", () => {
    expect(() =>
      decrypt("ENC1:AAAAAAAAAAAAAAAA:AAAA:!!!", key, AAD),
    ).toThrow(/Malformed base64 in tag/);
  });
});
