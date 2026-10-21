import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import {
  deleteRule,
  findNoDataConditions,
  findRulesBySensorId,
  fromDdbItems,
  getRule,
  listRulesByOwner,
  putRule,
  toWriteSet
} from "../src/index";
import type { RuleObject } from "../src/index";
import { uuidV5 } from "../src/uuid";

const ddbMock = mockClient(DynamoDBDocumentClient);
const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "ap-northeast-1" }));

type Item = Record<string, unknown>;

// Legacy rule on sensor s1, as v1 writes it, with its lastTrigger item.
const LEGACY_ID = "legacy-rule";
const LEGACY_ITEMS: Item[] = [
  { ruleId: LEGACY_ID, metadata: "owner", ownerId: "owner-1", areaId: "area-1" },
  { ruleId: LEGACY_ID, metadata: "name", name: "舊規則" },
  { ruleId: LEGACY_ID, metadata: "condition-s1->", sensorId: "s1", condition: ">", value: 30, conditionType: "Continual", conditionUnit: "Times", conditionLimit: 2 },
  { ruleId: LEGACY_ID, metadata: "lastTrigger", value: "2026-07-01T00:00:00.000Z" }
];

// Legacy no-data rule on sensor s3.
const LEGACY_NO_DATA_ID = "legacy-no-data";
const LEGACY_NO_DATA_ITEMS: Item[] = [
  { ruleId: LEGACY_NO_DATA_ID, metadata: "owner", ownerId: "owner-2" },
  { ruleId: LEGACY_NO_DATA_ID, metadata: "condition-s3-no-data", sensorId: "s3", condition: "no-data", value: 0, duration: 2, conditionType: "-1" }
];

// v2 rule: a comparison on s1 and a no-data condition on s2.
const V2_RULE: RuleObject = {
  id: "v2-rule",
  name: "新規則",
  ownerId: "owner-1",
  areaId: "area-1",
  enabled: true,
  cooldownMs: 0,
  groupMode: "all",
  groups: [
    {
      id: "g1",
      mode: "any",
      conditions: [
        { id: uuidV5("q/c1"), sensorId: "s1", operator: "<", threshold: 10.5, enabled: true, sustain: { type: "count", n: 1 } },
        { id: uuidV5("q/c2"), sensorId: "s2", operator: "no-data", noDataMinutes: 30, enabled: false }
      ]
    }
  ],
  ruleControllers: [],
  notify: { type: "telegram", recipient: "12345" }
};

function v2Items(rule: RuleObject = V2_RULE): Item[] {
  const written = toWriteSet(rule);
  if (!written.ok) throw new Error(written.errors.join("; "));
  return written.data.puts as unknown as Item[];
}

function byMetadata(items: Item[], metadata: string): Item {
  const item = items.find((candidate) => candidate.metadata === metadata);
  if (!item) throw new Error(`no ${metadata}`);
  return item;
}

function legacyRule(items: Item[]): RuleObject {
  const result = fromDdbItems(items);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.data;
}

/** Answers the base-table query on ruleId with the given items. */
function stored(ruleId: string, items: Item[]): void {
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":ruleId": ruleId } }).resolves({ Items: items });
}

function index(name: string, values: Item, items: Item[]): void {
  ddbMock.on(QueryCommand, { IndexName: name, ExpressionAttributeValues: values }).resolves({ Items: items });
}

function baseQueriesFor(ruleId: string): number {
  return ddbMock.commandCalls(QueryCommand).filter((call) => call.args[0].input.ExpressionAttributeValues?.[":ruleId"] === ruleId).length;
}

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(QueryCommand).resolves({ Items: [] });
  ddbMock.on(TransactWriteCommand).resolves({});
});

describe("getRule", () => {
  it("reads a legacy rule with a consistent query on ruleId", async () => {
    stored(LEGACY_ID, LEGACY_ITEMS);
    expect(await getRule(client, LEGACY_ID)).toEqual({ ok: true, data: legacyRule(LEGACY_ITEMS) });
    expect(ddbMock.commandCalls(QueryCommand)[0]?.args[0].input).toMatchObject({
      TableName: "SensorRule",
      KeyConditionExpression: "ruleId = :ruleId",
      ConsistentRead: true
    });
  });

  it("reads a v2 rule", async () => {
    stored(V2_RULE.id, v2Items());
    expect(await getRule(client, V2_RULE.id)).toEqual({ ok: true, data: V2_RULE });
  });

  it("follows pagination", async () => {
    ddbMock
      .on(QueryCommand, { ExpressionAttributeValues: { ":ruleId": LEGACY_ID } })
      .resolvesOnce({ Items: LEGACY_ITEMS.slice(0, 2), LastEvaluatedKey: { ruleId: LEGACY_ID, metadata: "name" } })
      .resolvesOnce({ Items: LEGACY_ITEMS.slice(2) });
    expect(await getRule(client, LEGACY_ID, { tableName: "SensorRule-staging" })).toEqual({ ok: true, data: legacyRule(LEGACY_ITEMS) });
    const calls = ddbMock.commandCalls(QueryCommand);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.args[0].input).toMatchObject({ TableName: "SensorRule-staging", ExclusiveStartKey: { ruleId: LEGACY_ID, metadata: "name" } });
  });

  it("returns null when nothing but Rule State is stored", async () => {
    expect(await getRule(client, "missing")).toEqual({ ok: true, data: null });
    stored("deleted", [{ ruleId: "deleted", metadata: "state", version: 2 }, { ruleId: "deleted", metadata: "lastTrigger", value: "x" }]);
    expect(await getRule(client, "deleted")).toEqual({ ok: true, data: null });
  });

  it("reports a rule that cannot be read", async () => {
    stored("orphan", [{ ruleId: "orphan", metadata: "condition-s->", sensorId: "s", condition: ">", value: 1 }]);
    expect(await getRule(client, "orphan")).toEqual({ ok: false, errors: ["legacy rule orphan: legacy rule has no owner item"] });
  });
});

describe("findRulesBySensorId", () => {
  it("finds legacy rules through their condition items", async () => {
    index("sensorId-index", { ":sensorId": "s1" }, [byMetadata(LEGACY_ITEMS, "condition-s1->")]);
    stored(LEGACY_ID, LEGACY_ITEMS);
    expect(await findRulesBySensorId(client, "s1")).toEqual({ rules: [legacyRule(LEGACY_ITEMS)], errors: [] });
  });

  it("finds v2 rules through their index items", async () => {
    const items = v2Items();
    index("sensorId-index", { ":sensorId": "s1" }, [byMetadata(items, "sensor#s1")]);
    stored(V2_RULE.id, items);
    expect(await findRulesBySensorId(client, "s1")).toEqual({ rules: [V2_RULE], errors: [] });
  });

  it("reads each rule once, drops rules that no longer use the sensor and reports unreadable ones", async () => {
    const moved = { ...V2_RULE, id: "moved", groups: [{ id: "g", mode: "all" as const, conditions: [{ ...V2_RULE.groups[0]!.conditions[0]!, sensorId: "s9" }] }] };
    ddbMock
      .on(QueryCommand, { IndexName: "sensorId-index", ExpressionAttributeValues: { ":sensorId": "s1" } })
      .resolvesOnce({
        Items: [byMetadata(LEGACY_ITEMS, "condition-s1->"), { ruleId: LEGACY_ID, metadata: "condition-s1-<", sensorId: "s1" }],
        LastEvaluatedKey: { ruleId: LEGACY_ID }
      })
      .resolvesOnce({ Items: [{ ruleId: "moved", metadata: "sensor#s1", sensorId: "s1" }, { ruleId: "broken", metadata: "condition-s1->", sensorId: "s1" }] });
    stored(LEGACY_ID, LEGACY_ITEMS);
    stored("moved", v2Items(moved));
    stored("broken", [{ ruleId: "broken", metadata: "condition-s1->", sensorId: "s1", condition: ">", value: 1 }]);

    const found = await findRulesBySensorId(client, "s1");
    expect(found.rules.map((rule) => rule.id)).toEqual([LEGACY_ID]);
    expect(found.errors).toEqual([{ ruleId: "broken", errors: ["legacy rule broken: legacy rule has no owner item"] }]);
    expect(baseQueriesFor(LEGACY_ID)).toBe(1);
  });
});

describe("findNoDataConditions", () => {
  it("finds legacy no-data conditions", async () => {
    index("condition-index", { ":condition": "no-data" }, [byMetadata(LEGACY_NO_DATA_ITEMS, "condition-s3-no-data")]);
    stored(LEGACY_NO_DATA_ID, LEGACY_NO_DATA_ITEMS);
    const found = await findNoDataConditions(client);
    expect(found.errors).toEqual([]);
    expect(found.conditions).toHaveLength(1);
    expect(found.conditions[0]?.rule.id).toBe(LEGACY_NO_DATA_ID);
    expect(found.conditions[0]?.condition).toMatchObject({ sensorId: "s3", operator: "no-data", noDataMinutes: 120, enabled: true });
    expect(ddbMock.commandCalls(QueryCommand)[0]?.args[0].input).toMatchObject({
      IndexName: "condition-index",
      KeyConditionExpression: "#condition = :condition",
      ExpressionAttributeNames: { "#condition": "condition" }
    });
  });

  it("finds v2 no-data conditions, disabled ones included", async () => {
    const items = v2Items();
    index("condition-index", { ":condition": "no-data" }, [byMetadata(items, "sensor#s2")]);
    stored(V2_RULE.id, items);
    const found = await findNoDataConditions(client);
    expect(found.conditions).toEqual([{ rule: V2_RULE, condition: V2_RULE.groups[0]?.conditions[1] }]);
  });
});

describe("listRulesByOwner", () => {
  it("reads legacy rules from their items", async () => {
    index("ownerId-ruleId-index", { ":ownerId": "owner-1" }, [byMetadata(LEGACY_ITEMS, "owner")]);
    stored(LEGACY_ID, LEGACY_ITEMS);
    expect(await listRulesByOwner(client, "owner-1")).toEqual({ rules: [legacyRule(LEGACY_ITEMS)], errors: [] });
  });

  it("reads v2 rules straight from the definition item in the index", async () => {
    index("ownerId-ruleId-index", { ":ownerId": "owner-1" }, [byMetadata(v2Items(), "definition")]);
    expect(await listRulesByOwner(client, "owner-1")).toEqual({ rules: [V2_RULE], errors: [] });
    expect(baseQueriesFor(V2_RULE.id)).toBe(0);
  });

  it("reports a v2 definition that cannot be read", async () => {
    index("ownerId-ruleId-index", { ":ownerId": "owner-1" }, [{ ...byMetadata(v2Items(), "definition"), schemaVersion: 9 }]);
    expect(await listRulesByOwner(client, "owner-1")).toEqual({
      rules: [],
      errors: [{ ruleId: V2_RULE.id, errors: ["Rule v2-rule uses schemaVersion 9; this SDK supports up to 2"] }]
    });
  });
});

describe("putRule", () => {
  it("converts a legacy rule in one transaction and keeps its Rule State", async () => {
    stored(LEGACY_ID, LEGACY_ITEMS);
    const rule = { ...legacyRule(LEGACY_ITEMS), name: "改過的規則" };
    expect(await putRule(client, rule, { tableName: "SensorRule-test" })).toEqual({ ok: true, errors: [] });

    const calls = ddbMock.commandCalls(TransactWriteCommand);
    expect(calls).toHaveLength(1);
    const transactItems = calls[0]?.args[0].input.TransactItems ?? [];
    expect(transactItems.map((item) => (item.Put ? `put ${String(item.Put.Item?.metadata)}` : `delete ${String(item.Delete?.Key?.metadata)}`))).toEqual([
      "put definition",
      "put sensor#s1",
      "delete owner",
      "delete name",
      "delete condition-s1->"
    ]);
    expect(transactItems.every((item) => (item.Put ?? item.Delete)?.TableName === "SensorRule-test")).toBe(true);
    expect(transactItems[0]?.Put?.Item).toMatchObject({ ownerId: "owner-1", rule: { name: "改過的規則" } });
  });

  it("does not write an invalid rule", async () => {
    const result = await putRule(client, { ...V2_RULE, ownerId: "" });
    expect(result).toEqual({ ok: false, errors: ["RuleObject.ownerId is required"] });
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });
});

describe("deleteRule", () => {
  it("deletes every item of the rule, its Rule State included", async () => {
    const items = [...v2Items(), { ruleId: V2_RULE.id, metadata: "state", version: 1 }, { ruleId: V2_RULE.id, metadata: "lastTrigger", value: "x" }];
    stored(V2_RULE.id, items);
    expect(await deleteRule(client, V2_RULE.id)).toEqual({ deleted: 5 });
    const keys = ddbMock.commandCalls(TransactWriteCommand)[0]?.args[0].input.TransactItems?.map((item) => item.Delete?.Key);
    expect(keys).toEqual(items.map((item) => ({ ruleId: V2_RULE.id, metadata: item.metadata })));
  });

  it("deletes more than 100 leftover items in several transactions and does nothing for a missing rule", async () => {
    stored("junk", Array.from({ length: 150 }, (_, i) => ({ ruleId: "junk", metadata: `condition-${i}` })));
    expect(await deleteRule(client, "junk")).toEqual({ deleted: 150 });
    expect(ddbMock.commandCalls(TransactWriteCommand).map((call) => call.args[0].input.TransactItems?.length)).toEqual([100, 50]);

    ddbMock.resetHistory();
    expect(await deleteRule(client, "missing")).toEqual({ deleted: 0 });
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });
});
