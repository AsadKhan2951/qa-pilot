import { randomBytes } from "node:crypto";

/** Short, URL-safe, unguessable id (used for DB ids and artifact paths). */
export function createId(): string {
  return randomBytes(12).toString("base64url");
}
