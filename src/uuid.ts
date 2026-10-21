import { createHash } from "node:crypto";

/** Namespace of the IDs this SDK derives (fixed; changing it changes every derived ID). */
export const SDK_UUID_NAMESPACE = "9b2f6c1e-5a4d-4e8b-a7c3-2d1f0e9b8a76";

/**
 * Name-based UUID (version 5, RFC 9562). The same name always yields the same ID,
 * which keeps the IDs given to legacy conditions stable across reads.
 */
export function uuidV5(name: string, namespace: string = SDK_UUID_NAMESPACE): string {
  const namespaceBytes = Buffer.from(namespace.replace(/-/g, ""), "hex");
  if (namespaceBytes.length !== 16) throw new Error(`Invalid UUID namespace: ${namespace}`);
  const bytes = createHash("sha1").update(namespaceBytes).update(name, "utf8").digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
