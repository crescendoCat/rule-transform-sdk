import { QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient, QueryCommandInput } from "@aws-sdk/lib-dynamodb";
import type { NoDataCondition, RuleObject } from "./rule-object";
import {
  DEFAULT_TABLE_NAME,
  DEFINITION_METADATA,
  fromDdbItems,
  MAX_TRANSACTION_ACTIONS,
  RULE_STATE_METADATA,
  SENSOR_INDEX_PREFIX,
  toTransactWriteItems,
  toWriteSet
} from "./storage";
import type { TransformResult, ValidationResult } from "./types";

/*
 * DynamoDB access for Sensor Rules. Every function takes a v3 DynamoDBDocumentClient:
 * the SDK never creates a client, so the endpoint, region and credentials stay the
 * caller's choice. Queries find rules in both layouts and follow pagination.
 */

export interface TableOptions {
  /** Defaults to "SensorRule". */
  tableName?: string;
}

/** Rules found by a query, plus the rules that could not be read and why. */
export interface RuleLookup {
  rules: RuleObject[];
  errors: { ruleId: string; errors: string[] }[];
}

export interface NoDataConditionRef {
  rule: RuleObject;
  condition: NoDataCondition;
}

export interface NoDataLookup {
  conditions: NoDataConditionRef[];
  errors: { ruleId: string; errors: string[] }[];
}

type Item = Record<string, unknown>;

const SENSOR_ID_INDEX = "sensorId-index";
const CONDITION_INDEX = "condition-index";
const OWNER_INDEX = "ownerId-ruleId-index";

function tableOf(options: TableOptions): string {
  return options.tableName ?? DEFAULT_TABLE_NAME;
}

async function queryAll(client: DynamoDBDocumentClient, input: QueryCommandInput): Promise<Item[]> {
  const items: Item[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await client.send(
      new QueryCommand(exclusiveStartKey ? { ...input, ExclusiveStartKey: exclusiveStartKey } : input)
    );
    items.push(...((page.Items ?? []) as Item[]));
    exclusiveStartKey = page.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return items;
}

/** Every item stored under a rule ID (definition, index, legacy and Rule State items). */
async function queryRuleItems(client: DynamoDBDocumentClient, ruleId: string, options: TableOptions): Promise<Item[]> {
  return queryAll(client, {
    TableName: tableOf(options),
    KeyConditionExpression: "ruleId = :ruleId",
    ExpressionAttributeValues: { ":ruleId": ruleId },
    ConsistentRead: true
  });
}

function holdsDefinition(item: Item): boolean {
  const metadata = String(item.metadata ?? "");
  return !RULE_STATE_METADATA.has(metadata) && !metadata.startsWith(SENSOR_INDEX_PREFIX);
}

function distinctRuleIds(items: Item[]): string[] {
  return [...new Set(items.map((item) => String(item.ruleId ?? "")).filter((id) => id !== ""))];
}

async function loadRules(client: DynamoDBDocumentClient, ruleIds: string[], options: TableOptions): Promise<RuleLookup> {
  const lookup: RuleLookup = { rules: [], errors: [] };
  const results = await Promise.all(ruleIds.map((ruleId) => getRule(client, ruleId, options)));
  results.forEach((result, index) => {
    const ruleId = ruleIds[index] as string;
    if (!result.ok) lookup.errors.push({ ruleId, errors: result.errors });
    else if (result.data) lookup.rules.push(result.data);
  });
  return lookup;
}

/**
 * Reads one rule in either layout. `data` is null when nothing but Rule State (or nothing at all)
 * is stored under the ID.
 */
export async function getRule(
  client: DynamoDBDocumentClient,
  ruleId: string,
  options: TableOptions = {}
): Promise<TransformResult<RuleObject | null>> {
  const items = await queryRuleItems(client, ruleId, options);
  if (!items.some(holdsDefinition)) return { ok: true, data: null };
  return fromDdbItems(items);
}

/** Rules with a condition on the sensor, for the rule engine when a reading arrives. */
export async function findRulesBySensorId(
  client: DynamoDBDocumentClient,
  sensorId: string,
  options: TableOptions = {}
): Promise<RuleLookup> {
  const indexed = await queryAll(client, {
    TableName: tableOf(options),
    IndexName: SENSOR_ID_INDEX,
    KeyConditionExpression: "sensorId = :sensorId",
    ExpressionAttributeValues: { ":sensorId": sensorId }
  });
  const lookup = await loadRules(client, distinctRuleIds(indexed), options);
  // The index is eventually consistent: drop rules that no longer reference the sensor.
  lookup.rules = lookup.rules.filter((rule) =>
    rule.groups.some((group) => group.conditions.some((condition) => condition.sensorId === sensorId))
  );
  return lookup;
}

/** Every no-data condition with its rule, for the no-data service. Callers check `enabled`. */
export async function findNoDataConditions(client: DynamoDBDocumentClient, options: TableOptions = {}): Promise<NoDataLookup> {
  const indexed = await queryAll(client, {
    TableName: tableOf(options),
    IndexName: CONDITION_INDEX,
    KeyConditionExpression: "#condition = :condition",
    ExpressionAttributeNames: { "#condition": "condition" },
    ExpressionAttributeValues: { ":condition": "no-data" }
  });
  const { rules, errors } = await loadRules(client, distinctRuleIds(indexed), options);
  const conditions: NoDataConditionRef[] = [];
  for (const rule of rules) {
    for (const group of rule.groups) {
      for (const condition of group.conditions) {
        if (condition.operator === "no-data") conditions.push({ rule, condition });
      }
    }
  }
  return { conditions, errors };
}

/** Rules owned by an account. v2 rules are read straight from the index; legacy rules need their items. */
export async function listRulesByOwner(
  client: DynamoDBDocumentClient,
  ownerId: string,
  options: TableOptions = {}
): Promise<RuleLookup> {
  const indexed = await queryAll(client, {
    TableName: tableOf(options),
    IndexName: OWNER_INDEX,
    KeyConditionExpression: "ownerId = :ownerId",
    ExpressionAttributeValues: { ":ownerId": ownerId }
  });
  const lookup: RuleLookup = { rules: [], errors: [] };
  const legacyIds: string[] = [];
  for (const ruleId of distinctRuleIds(indexed)) {
    const definition = indexed.find((item) => item.ruleId === ruleId && item.metadata === DEFINITION_METADATA);
    if (!definition) {
      legacyIds.push(ruleId);
      continue;
    }
    const result = fromDdbItems([definition]);
    if (result.ok) lookup.rules.push(result.data);
    else lookup.errors.push({ ruleId, errors: result.errors });
  }
  const legacy = await loadRules(client, legacyIds, options);
  lookup.rules.push(...legacy.rules);
  lookup.errors.push(...legacy.errors);
  return lookup;
}

/**
 * Writes a rule in the v2 layout in one transaction. A legacy rule is converted (its legacy items
 * are deleted); the Rule State is left untouched. Returns the validation errors when the rule is invalid.
 */
export async function putRule(
  client: DynamoDBDocumentClient,
  ruleObject: RuleObject,
  options: TableOptions = {}
): Promise<ValidationResult> {
  const previous = await queryRuleItems(client, ruleObject.id, options);
  const writeSet = toWriteSet(ruleObject, previous);
  if (!writeSet.ok) return { ok: false, errors: writeSet.errors };
  await client.send(new TransactWriteCommand({ TransactItems: toTransactWriteItems(writeSet.data, tableOf(options)) }));
  return { ok: true, errors: [] };
}

/**
 * Deletes every item of a rule, including its Rule State. Rules of up to 100 items are deleted in one
 * transaction; larger leftovers are deleted in several. Resolves to the number of items deleted.
 */
export async function deleteRule(
  client: DynamoDBDocumentClient,
  ruleId: string,
  options: TableOptions = {}
): Promise<{ deleted: number }> {
  const items = await queryRuleItems(client, ruleId, options);
  const tableName = tableOf(options);
  for (let start = 0; start < items.length; start += MAX_TRANSACTION_ACTIONS) {
    const chunk = items.slice(start, start + MAX_TRANSACTION_ACTIONS);
    await client.send(
      new TransactWriteCommand({
        TransactItems: chunk.map((item) => ({
          Delete: { TableName: tableName, Key: { ruleId, metadata: String(item.metadata) } }
        }))
      })
    );
  }
  return { deleted: items.length };
}
