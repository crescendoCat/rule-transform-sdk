import type { TransformResult } from "./types";

/*
 * ruleChange messages, published on `notifyEngine/ruleChange` whenever a Sensor Rule changes.
 * The API encodes them through the SDK; the engine and the no-data service decode them through it.
 * decodeRuleChange also understands the messages the legacy API sends, so consumers can take both
 * during the transition.
 */

export const RULE_CHANGE_TOPIC = "notifyEngine/ruleChange";
export const RULE_CHANGE_SCHEMA_VERSION = 2;

export type RuleChangeType = "created" | "updated" | "deleted";

export interface RuleChange {
  type: RuleChangeType;
  ruleId: string;
}

export interface DecodedRuleChange extends RuleChange {
  /** `v2` for messages from encodeRuleChange, `legacy` for messages of the legacy API. */
  format: "v2" | "legacy";
  /** The legacy message string (`msg`), when there was one. */
  legacyMessage?: string;
}

const CHANGE_TYPES = new Set<RuleChangeType>(["created", "updated", "deleted"]);

/**
 * `msg` strings of the legacy API: v1 (src/legacy/SensorRulev1.js) and /api/v2/sensor-rule
 * (src/legacy/sensor-rule). A change to part of a rule (a condition, a controller, the
 * notification) is an update of the rule.
 */
const LEGACY_MESSAGES: Record<string, RuleChangeType> = {
  "add-rule": "created",
  "delete-rule": "deleted",
  "update-condition": "updated",
  "delete-condition": "updated",
  "update-notification": "updated",
  "delete-notification": "updated",
  "delete-controller": "updated",
  "Rule created": "created",
  "Rule updated": "updated",
  "Rule deleted": "deleted",
  "Condition updated": "updated",
  "Condition deleted": "updated",
  "Controller updated": "updated",
  "Controller deleted": "updated"
};

/**
 * Legacy `type` values, used only when `msg` is missing or unknown. "delete" may be the deletion of
 * a part of the rule, so it is read as an update: consumers reload the rule and see whether it is gone.
 */
const LEGACY_TYPES: Record<string, RuleChangeType> = { add: "created", update: "updated", delete: "updated" };

/** Encodes a ruleChange message (a JSON string). Throws on an invalid change. */
export function encodeRuleChange(change: RuleChange): string {
  if (!CHANGE_TYPES.has(change.type)) throw new Error(`Unknown rule change type: ${String(change.type)}`);
  if (typeof change.ruleId !== "string" || change.ruleId === "") throw new Error("RuleChange.ruleId is required");
  return JSON.stringify({ schemaVersion: RULE_CHANGE_SCHEMA_VERSION, type: change.type, ruleId: change.ruleId });
}

function parsePayload(payload: unknown): Record<string, unknown> {
  let value = payload;
  if (value instanceof Uint8Array) value = new TextDecoder().decode(value);
  if (typeof value === "string") value = JSON.parse(value);
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("ruleChange payload must be a JSON object");
  return value as Record<string, unknown>;
}

/** Decodes a ruleChange message in the v2 format or in either legacy format. */
export function decodeRuleChange(payload: unknown): TransformResult<DecodedRuleChange> {
  let message: Record<string, unknown>;
  try {
    message = parsePayload(payload);
  } catch (error) {
    return { ok: false, errors: [`Cannot parse ruleChange payload: ${(error as Error).message}`] };
  }

  const ruleId = message.ruleId;
  if (typeof ruleId !== "string" || ruleId === "") return { ok: false, errors: ["ruleChange payload has no ruleId"] };

  if (message.schemaVersion !== undefined) {
    if (message.schemaVersion !== RULE_CHANGE_SCHEMA_VERSION) {
      return { ok: false, errors: [`ruleChange schemaVersion ${String(message.schemaVersion)} is not supported`] };
    }
    if (typeof message.type !== "string" || !CHANGE_TYPES.has(message.type as RuleChangeType)) {
      return { ok: false, errors: [`Unknown rule change type: ${String(message.type)}`] };
    }
    return { ok: true, data: { type: message.type as RuleChangeType, ruleId, format: "v2" } };
  }

  const legacyMessage = typeof message.msg === "string" ? message.msg : undefined;
  const type =
    (legacyMessage !== undefined ? LEGACY_MESSAGES[legacyMessage] : undefined) ??
    (typeof message.type === "string" ? LEGACY_TYPES[message.type] : undefined);
  if (!type) {
    return { ok: false, errors: [`Unknown legacy ruleChange message: type ${String(message.type)}, msg ${String(message.msg)}`] };
  }
  const decoded: DecodedRuleChange = { type, ruleId, format: "legacy" };
  if (legacyMessage !== undefined) decoded.legacyMessage = legacyMessage;
  return { ok: true, data: decoded };
}
