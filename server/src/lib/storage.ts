import fs from "node:fs/promises";
import path from "node:path";
import { env } from "./env.js";

/** Saves a file under ARTIFACTS_DIR and returns its relative path (stored in DB). */
export async function saveArtifact(relPath: string, data: Buffer | string): Promise<string> {
  const full = artifactPath(relPath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, data);
  return relPath;
}

export function artifactPath(relPath: string): string {
  const full = path.resolve(env.artifactsDir, relPath);
  if (!full.startsWith(env.artifactsDir)) throw new Error("Invalid artifact path");
  return full;
}

export async function readArtifact(relPath: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(artifactPath(relPath));
  } catch {
    return null;
  }
}
