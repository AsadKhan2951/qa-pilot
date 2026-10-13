import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "./env.js";

const key = Buffer.from(env.encryptionKey, "base64");
if (key.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes (base64). Run: openssl rand -base64 32");

/** AES-256-GCM. Output: iv.tag.ciphertext (base64url). */
export function encrypt(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

export function decrypt<T = unknown>(payload: string): T | null {
  if (!payload) return null;
  const [iv, tag, data] = payload.split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  return JSON.parse(out) as T;
}

export type Credentials = { username?: string; password?: string; notes?: string };
export type ApiAuth = { headerName?: string; headerValue?: string };
