import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { TableOptions } from "./queries";
import { DEFAULT_TABLE_NAME, SCHEMA_VERSION } from "./storage";

/*
 * Rule State: the runtime state of a Sensor Rule, written only by the rule engine and kept
 * apart from the rule definition (putRule never touches it). Stored in the SensorRule table
 * as { ruleId, metadata: "state", ... }; a legacy rule's "lastTrigger" item is read as the
 * initial last trigger time until the first state is written.
 */

export const RULE_STATE_METADATA_KEY = "state";

export interface RuleState {
  /** ISO 8601 time of the latest trigger; null when the rule has never triggered. */
  lastTriggeredAt: string | null;
  /** True while the rule has triggered and not yet recovered. */
  triggered: boolean;
  /** ISO 8601 time of the latest recovery; null when it has never recovered. */
  recoveredAt: string | null;
  /**
   * Version of the stored state; 0 when no state item exists yet. Pass back the version you read:
   * putRuleState only writes when the stored version is still the same.
   */
  version: number;
}

export type PutRuleStateResult =
  | { ok: true; version: number }
  | { ok: false; conflict: boolean; errors: string[] };

function optionalIso(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** Reads the Rule State, falling back to the legacy lastTrigger item, then to the initial state. */
export async function getRuleState(client: DynamoDBDocumentClient, ruleId: string, options: TableOptions = {}): Promise<RuleState> {
  const TableName = options.tableName ?? DEFAULT_TABLE_NAME;
  const state = await client.send(new GetCommand({ TableName, Key: { ruleId, metadata: RULE_STATE_METADATA_KEY }, ConsistentRead: true }));
  if (state.Item) {
    return {
      lastTriggeredAt: optionalIso(state.Item.lastTriggeredAt),
      triggered: state.Item.triggered === true,
      recoveredAt: optionalIso(state.Item.recoveredAt),
      version: Number(state.Item.version) || 0
    };
  }
  const legacy = await client.send(new GetCommand({ TableName, Key: { ruleId, metadata: "lastTrigger" }, ConsistentRead: true }));
  return { lastTriggeredAt: optionalIso(legacy.Item?.value), triggered: false, recoveredAt: null, version: 0 };
}

function stateErrors(state: RuleState): string[] {
  const errors: string[] = [];
  for (const field of ["lastTriggeredAt", "recoveredAt"] as const) {
    const value = state[field];
    if (value !== null && (typeof value !== "string" || Number.isNaN(Date.parse(value)))) {
      errors.push(`RuleState.${field} must be an ISO 8601 time or null`);
    }
  }
  if (typeof state.triggered !== "boolean") errors.push("RuleState.triggered must be a boolean");
  if (!Number.isInteger(state.version) || state.version < 0) errors.push("RuleState.version must be an integer >= 0");
  return errors;
}

/**
 * Writes the Rule State if nobody else wrote it since `state.version` was read (optimistic
 * concurrency between engine instances handling the same rule). On a version conflict nothing is
 * written and `conflict` is true: read the state again and retry.
 */
export async function putRuleState(
  client: DynamoDBDocumentClient,
  ruleId: string,
  state: RuleState,
  options: TableOptions = {}
): Promise<PutRuleStateResult> {
  const errors = stateErrors(state);
  if (errors.length > 0) return { ok: false, conflict: false, errors };

  const version = state.version + 1;
  const Item: Record<string, unknown> = {
    ruleId,
    metadata: RULE_STATE_METADATA_KEY,
    schemaVersion: SCHEMA_VERSION,
    version,
    triggered: state.triggered
  };
  if (state.lastTriggeredAt !== null) Item.lastTriggeredAt = state.lastTriggeredAt;
  if (state.recoveredAt !== null) Item.recoveredAt = state.recoveredAt;

  const condition =
    state.version === 0
      ? { ConditionExpression: "attribute_not_exists(ruleId)" }
      : {
          ConditionExpression: "#version = :expected",
          ExpressionAttributeNames: { "#version": "version" },
          ExpressionAttributeValues: { ":expected": state.version }
        };
  try {
    await client.send(new PutCommand({ TableName: options.tableName ?? DEFAULT_TABLE_NAME, Item, ...condition }));
    return { ok: true, version };
  } catch (error) {
    if ((error as { name?: string }).name === "ConditionalCheckFailedException") {
      return { ok: false, conflict: true, errors: [`Rule State of ${ruleId} changed after version ${state.version} was read`] };
    }
    throw error;
  }
}
