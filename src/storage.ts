import { normalizeRawItem } from "./legacy";
import { ruleObjectFromLegacyItems } from "./legacy-mapping";
import type { RuleObject } from "./rule-object";
import type { TransformResult } from "./types";
import { validateRuleObject } from "./validate";

/*
 * Storage layout of the SensorRule table. This is an internal detail of the SDK:
 * consumers read and write RuleObjects and never depend on these item shapes.
 *
 * v2 layout (schemaVersion 2), all in the existing table and GSIs:
 * - one definition item  { ruleId, metadata: "definition", schemaVersion, ownerId, rule }
 *   `ownerId` keeps the rule in ownerId-ruleId-index; the item has no sensorId / condition,
 *   so it stays out of sensorId-index and condition-index.
 * - one index item per referenced sensor  { ruleId, metadata: "sensor#<sensorId>", schemaVersion, sensorId }
 *   (in sensorId-index); a sensor used by a no-data condition also has condition: "no-data"
 *   (in condition-index).
 * Runtime state (legacy "lastTrigger", v2 "state") is never part of a definition write.
 */

export const DEFAULT_TABLE_NAME = "SensorRule";
export const SCHEMA_VERSION = 2;
export const DEFINITION_METADATA = "definition";
export const SENSOR_INDEX_PREFIX = "sensor#";
/** Items holding the Rule State rather than the rule definition. */
export const RULE_STATE_METADATA = new Set(["lastTrigger", "state"]);
/** TransactWriteItems accepts at most this many actions. */
export const MAX_TRANSACTION_ACTIONS = 100;

export interface RuleItemKey {
  ruleId: string;
  metadata: string;
}

export interface RuleDefinitionItem extends RuleItemKey {
  metadata: typeof DEFINITION_METADATA;
  schemaVersion: number;
  ownerId: string;
  rule: RuleObject;
}

export interface RuleSensorIndexItem extends RuleItemKey {
  schemaVersion: number;
  sensorId: string;
  condition?: "no-data";
}

/** Items to put and keys to delete, written together in one transaction. */
export interface WriteSet {
  puts: (RuleDefinitionItem | RuleSensorIndexItem)[];
  deletes: RuleItemKey[];
}

/** Input of DynamoDB DocumentClient's TransactWriteCommand (`TransactItems`). */
export type DocumentTransactWriteItem =
  | { Put: { TableName: string; Item: Record<string, unknown> } }
  | { Delete: { TableName: string; Key: RuleItemKey } };

type RawItem = Record<string, unknown>;

function normalizeAll(items: readonly unknown[]): RawItem[] {
  return items.map((item, index) => {
    if (typeof item !== "object" || item === null) throw new Error(`items[${index}] must be an object`);
    return normalizeRawItem(item as RawItem);
  });
}

function sameRuleId(items: RawItem[]): string {
  const ruleId = String(items[0]?.ruleId ?? "");
  if (!ruleId) throw new Error("Missing ruleId in input items");
  for (const item of items) {
    if (String(item.ruleId ?? "") !== ruleId) {
      throw new Error(`Mixed ruleId detected: ${String(item.ruleId)} vs ${ruleId}`);
    }
  }
  return ruleId;
}

function checkSchemaVersion(item: RawItem): void {
  const version = Number(item.schemaVersion);
  if (version > SCHEMA_VERSION) {
    throw new Error(`Rule ${String(item.ruleId)} uses schemaVersion ${version}; this SDK supports up to ${SCHEMA_VERSION}`);
  }
}

/**
 * True when the items of a rule are in the v2 layout. The legacy API (v1) uses it to
 * leave v2 rules alone. Accepts DocumentClient items and raw AttributeValue items.
 */
export function isNewLayout(items: readonly unknown[]): boolean {
  return normalizeAll(items).some((item) => item.metadata === DEFINITION_METADATA);
}

/**
 * Reads every item of one rule (in either layout) as a RuleObject.
 * Index items and Rule State items are ignored. When a definition item exists it is
 * authoritative and any leftover legacy items are ignored.
 */
export function fromDdbItems(items: readonly unknown[]): TransformResult<RuleObject> {
  try {
    if (!Array.isArray(items) || items.length === 0) return { ok: false, errors: ["Input items must be a non-empty array"] };
    const normalized = normalizeAll(items);
    const ruleId = sameRuleId(normalized);

    const definition = normalized.find((item) => item.metadata === DEFINITION_METADATA);
    if (!definition) return ruleObjectFromLegacyItems(ruleId, normalized);

    checkSchemaVersion(definition);
    const rule = definition.rule as Record<string, unknown> | undefined;
    if (typeof rule !== "object" || rule === null) return { ok: false, errors: [`Rule ${ruleId}: definition item has no rule`] };
    if (rule.id !== ruleId) return { ok: false, errors: [`Rule ${ruleId}: definition holds rule ${String(rule.id)}`] };
    const validation = validateRuleObject(rule);
    if (!validation.ok) return { ok: false, errors: validation.errors.map((e) => `Rule ${ruleId}: ${e}`) };
    return { ok: true, data: rule as unknown as RuleObject };
  } catch (error) {
    return { ok: false, errors: [(error as Error).message] };
  }
}

function sensorIndexItems(rule: RuleObject): RuleSensorIndexItem[] {
  const noDataSensors = new Set<string>();
  const sensors = new Set<string>();
  for (const group of rule.groups) {
    for (const condition of group.conditions) {
      sensors.add(condition.sensorId);
      if (condition.operator === "no-data") noDataSensors.add(condition.sensorId);
    }
  }
  return [...sensors].sort().map((sensorId) => {
    const item: RuleSensorIndexItem = {
      ruleId: rule.id,
      metadata: `${SENSOR_INDEX_PREFIX}${sensorId}`,
      schemaVersion: SCHEMA_VERSION,
      sensorId
    };
    if (noDataSensors.has(sensorId)) item.condition = "no-data";
    return item;
  });
}

/**
 * Builds the items to put and delete so that, after one transaction, the rule is stored
 * in the v2 layout and nothing stale is left.
 *
 * `previousItems` are the items currently stored for the rule (all of them, as returned by
 * a query on ruleId; either layout). Everything previously stored that the new write does not
 * put is deleted: legacy items when converting a legacy rule, and index items of sensors the
 * rule no longer references. Rule State items are kept.
 */
export function toWriteSet(ruleObject: RuleObject, previousItems: readonly unknown[] = []): TransformResult<WriteSet> {
  try {
    const validation = validateRuleObject(ruleObject);
    if (!validation.ok) return { ok: false, errors: validation.errors };

    // A JSON copy drops undefined members and detaches the stored rule from the caller's object.
    const rule = JSON.parse(JSON.stringify(ruleObject)) as RuleObject;
    const definition: RuleDefinitionItem = {
      ruleId: rule.id,
      metadata: DEFINITION_METADATA,
      schemaVersion: SCHEMA_VERSION,
      ownerId: rule.ownerId,
      rule
    };
    const puts = [definition, ...sensorIndexItems(rule)];
    const putKeys = new Set(puts.map((item) => item.metadata));

    const deletes: RuleItemKey[] = [];
    const deleted = new Set<string>();
    for (const item of normalizeAll(previousItems)) {
      if (String(item.ruleId ?? "") !== rule.id) {
        return { ok: false, errors: [`previousItems contain an item of rule ${String(item.ruleId)}, not ${rule.id}`] };
      }
      if (item.metadata === DEFINITION_METADATA) checkSchemaVersion(item);
      const metadata = String(item.metadata ?? "");
      if (putKeys.has(metadata) || RULE_STATE_METADATA.has(metadata) || deleted.has(metadata)) continue;
      deleted.add(metadata);
      deletes.push({ ruleId: rule.id, metadata });
    }

    const actions = puts.length + deletes.length;
    if (actions > MAX_TRANSACTION_ACTIONS) {
      return { ok: false, errors: [`Writing rule ${rule.id} needs ${actions} actions; one transaction allows at most ${MAX_TRANSACTION_ACTIONS}`] };
    }
    return { ok: true, data: { puts, deletes } };
  } catch (error) {
    return { ok: false, errors: [(error as Error).message] };
  }
}

/** Turns a write set into `TransactItems` for DynamoDB DocumentClient's TransactWriteCommand. */
export function toTransactWriteItems(writeSet: WriteSet, tableName: string = DEFAULT_TABLE_NAME): DocumentTransactWriteItem[] {
  return [
    ...writeSet.puts.map((item) => ({ Put: { TableName: tableName, Item: { ...item } as Record<string, unknown> } })),
    ...writeSet.deletes.map((key) => ({ Delete: { TableName: tableName, Key: { ruleId: key.ruleId, metadata: key.metadata } } }))
  ];
}
