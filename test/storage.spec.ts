import { describe, expect, it } from "vitest";
import { fromDdbItems, isNewLayout, MAX_TRANSACTION_ACTIONS, toTransactWriteItems, toWriteSet } from "../src/index";
import type { ComparisonCondition, Condition, RuleObject } from "../src/index";
import { uuidV5 } from "../src/uuid";

// Items shaped like the ones v1 (src/legacy/SensorRulev1.js) writes in production, taken from
// IoT-Platform-API src/legacy/dynamodb/mockSensorRuleData.js and this repo's earlier raw fixture.
const V1_SINGLE_RULE = [
  { ruleId: { S: "10762f77-1119-4880-a28f-ba22cc586bda" }, metadata: { S: "owner" }, areaId: { S: "9f3ba901-9f46-40f6-81ca-ef93aecb37b0" }, ownerId: { S: "1321cf85-e3cf-4f48-b6ff-7d668b729305" } },
  { ruleId: { S: "10762f77-1119-4880-a28f-ba22cc586bda" }, metadata: { S: "name" }, name: { S: "705後方伺服器機櫃濕度監控" } },
  { ruleId: { S: "10762f77-1119-4880-a28f-ba22cc586bda" }, metadata: { S: "condition-8bfee68d-606a-47c6-bccf-f678d0f9cdee->=" }, conditionName: { S: "濕度過高" }, conditionType: { S: "Continual" }, condition: { S: ">=" }, value: { N: "75" }, conditionUnit: { S: "Times" }, conditionLimit: { S: "3" }, sensorId: { S: "8bfee68d-606a-47c6-bccf-f678d0f9cdee" } },
  { ruleId: { S: "10762f77-1119-4880-a28f-ba22cc586bda" }, metadata: { S: "notification" }, notificationType: { S: "email" }, notificationValue: { S: "c.crescendo.cat@gmail.com" } },
  { ruleId: { S: "10762f77-1119-4880-a28f-ba22cc586bda" }, metadata: { S: "minTriggerDuration" }, value: { N: "3600000" } }
];

const V1_LINE_OBJECT_RULE = [
  { conditionLimit: { S: "3" }, value: { S: "30" }, metadata: { S: "condition-4cf300a6-c282-416c-9a8e-c2d429ed646b->=" }, conditionUnit: { S: "Times" }, condition: { S: ">=" }, sensorId: { S: "4cf300a6-c282-416c-9a8e-c2d429ed646b" }, conditionType: { S: "Continual" }, ruleId: { S: "315c0292-8f16-4460-bcde-0e7134b657ed" }, conditionName: { S: "溫度過高" } },
  { value: { S: "2026-07-18T06:40:57.276Z" }, metadata: { S: "lastTrigger" }, ruleId: { S: "315c0292-8f16-4460-bcde-0e7134b657ed" } },
  { value: { S: "0" }, metadata: { S: "minTriggerDuration" }, ruleId: { S: "315c0292-8f16-4460-bcde-0e7134b657ed" } },
  { name: { S: "705後方伺服器機櫃溫度監控" }, metadata: { S: "name" }, ruleId: { S: "315c0292-8f16-4460-bcde-0e7134b657ed" } },
  { notificationType: { S: "line" }, metadata: { S: "notification" }, ruleId: { S: "315c0292-8f16-4460-bcde-0e7134b657ed" }, lineTokenCreatedAt: { S: "none" }, notificationValue: { M: { id_name: { S: "測試用" }, id_type: { S: "user" } } } },
  { metadata: { S: "owner" }, ruleId: { S: "315c0292-8f16-4460-bcde-0e7134b657ed" }, areaId: { S: "9f3ba901-9f46-40f6-81ca-ef93aecb37b0" }, ownerId: { S: "1321cf85-e3cf-4f48-b6ff-7d668b729305" } }
];

// mockListItems rule 6d3d8364: empty duration string, a LINE Notify token, no ruleMode / minTriggerDuration.
const V1_LINE_NOTIFY_RULE = [
  { conditionLimit: { S: "3" }, value: { S: "20" }, metadata: { S: "condition-8033bd47-d2b9-4c5a-9608-fa6aa14b894e->" }, conditionUnit: { S: "Times" }, condition: { S: ">" }, sensorId: { S: "8033bd47-d2b9-4c5a-9608-fa6aa14b894e" }, conditionType: { S: "Continual" }, ruleId: { S: "6d3d8364-b166-4470-a6d9-2fb237cbba6d" }, duration: { S: "" } },
  { value: { S: "2022-05-09T15:48:29.052Z" }, metadata: { S: "lastTrigger" }, ruleId: { S: "6d3d8364-b166-4470-a6d9-2fb237cbba6d" } },
  { name: { S: "test123" }, metadata: { S: "name" }, ruleId: { S: "6d3d8364-b166-4470-a6d9-2fb237cbba6d" } },
  { notificationType: { S: "line" }, metadata: { S: "notification" }, ruleId: { S: "6d3d8364-b166-4470-a6d9-2fb237cbba6d" }, lineTokenCreatedAt: { S: "1630039877336" }, notificationValue: { S: "legacy-line-token-A" } },
  { metadata: { S: "owner" }, ruleId: { S: "6d3d8364-b166-4470-a6d9-2fb237cbba6d" }, ownerId: { S: "1321cf85-e3cf-4f48-b6ff-7d668b729305" } }
];

// mockListItems rule 4b5602b2: a rule controller without `activate`.
const V1_CONTROLLER_RULE = [
  { conditionLimit: { S: "10" }, value: { S: "3" }, metadata: { S: "condition-f3d9c7c0-bffa-41c3-a6aa-de249a9bfa2a->=" }, conditionUnit: { S: "Times" }, condition: { S: ">=" }, sensorId: { S: "f3d9c7c0-bffa-41c3-a6aa-de249a9bfa2a" }, conditionType: { S: "Continual" }, ruleId: { S: "4b5602b2-d3e5-446b-886f-dada021e764b" }, conditionName: { S: "測試" } },
  { value: { S: "3" }, metadata: { S: "controller-df88f07e-9b54-4add-8c17-a3a99ff2af09" }, ruleId: { S: "4b5602b2-d3e5-446b-886f-dada021e764b" }, controllerName: { S: "智慧溫室 燈光" }, controllerId: { S: "df88f07e-9b54-4add-8c17-a3a99ff2af09" } },
  { name: { S: "testline4" }, metadata: { S: "name" }, ruleId: { S: "4b5602b2-d3e5-446b-886f-dada021e764b" } },
  { metadata: { S: "owner" }, ruleId: { S: "4b5602b2-d3e5-446b-886f-dada021e764b" }, ownerId: { S: "1321cf85-e3cf-4f48-b6ff-7d668b729305" } }
];

function legacyId(ruleId: string, metadata: string): string {
  return uuidV5(`${ruleId}/${metadata}`);
}

function readOk(items: unknown[]): RuleObject {
  const result = fromDdbItems(items);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.data;
}

function readErrors(items: unknown[]): string[] {
  const result = fromDdbItems(items);
  return result.ok ? [] : result.errors;
}

function comparison(index: number, sensorId: string): ComparisonCondition {
  return {
    id: uuidV5(`test/condition-${index}`),
    sensorId,
    operator: ">",
    threshold: 25.5 + index,
    recoveryThreshold: 24,
    enabled: index % 2 === 0,
    sustain: { type: "continuous", minutes: 10 }
  };
}

function v2Rule(overrides: Partial<RuleObject> = {}): RuleObject {
  return {
    id: "rule-v2",
    name: "溫室",
    ownerId: "owner-1",
    areaId: "area-1",
    enabled: true,
    cooldownMs: 600000,
    groupMode: "any",
    groups: [
      { id: "g1", mode: "all", conditions: [comparison(1, "sensor-a"), comparison(2, "sensor-b")] },
      {
        id: "g2",
        mode: "any",
        conditions: [
          { id: uuidV5("test/no-data"), sensorId: "sensor-c", operator: "no-data", noDataMinutes: 90, enabled: true },
          { ...comparison(3, "sensor-a"), sustain: { type: "ratio", windowMinutes: 30, percent: 75 } }
        ]
      }
    ],
    ruleControllers: [{ controllerId: "controller-1", name: "風扇", value: 120, enabled: true }],
    notify: { type: "line", recipient: { id_type: "group", id_name: "A 區" } },
    meta: { createdAt: "2026-10-01T00:00:00.000Z", createdBy: "owner-1" },
    ...overrides
  };
}

describe("uuidV5", () => {
  it("matches the RFC 9562 test vector and is deterministic", () => {
    expect(uuidV5("www.example.com", "6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2");
    expect(uuidV5("a")).toBe(uuidV5("a"));
    expect(uuidV5("a")).not.toBe(uuidV5("b"));
  });
});

describe("v2 layout", () => {
  it("round-trips a RuleObject through the write set", () => {
    const rule = v2Rule();
    const written = toWriteSet(rule);
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(readOk(written.data.puts)).toEqual(rule);
  });

  it("round-trips when read back as raw AttributeValue items", () => {
    const rule = v2Rule({ groups: [{ id: "g", mode: "all", conditions: [comparison(2, "s")] }], notify: { type: "email", recipient: "a@b.c" } });
    const condition = rule.groups[0]?.conditions[0] as ComparisonCondition;
    const raw = [
      {
        ruleId: { S: rule.id },
        metadata: { S: "definition" },
        schemaVersion: { N: "2" },
        ownerId: { S: rule.ownerId },
        rule: {
          M: {
            id: { S: rule.id }, name: { S: rule.name }, ownerId: { S: rule.ownerId }, areaId: { S: "area-1" },
            enabled: { BOOL: true }, cooldownMs: { N: "600000" }, groupMode: { S: "any" },
            groups: { L: [{ M: { id: { S: "g" }, mode: { S: "all" }, conditions: { L: [{ M: {
              id: { S: condition.id }, sensorId: { S: "s" }, operator: { S: ">" }, threshold: { N: String(condition.threshold) },
              recoveryThreshold: { N: "24" }, enabled: { BOOL: true }, sustain: { M: { type: { S: "continuous" }, minutes: { N: "10" } } }
            } }] } } }] },
            ruleControllers: { L: [{ M: { controllerId: { S: "controller-1" }, name: { S: "風扇" }, value: { N: "120" }, enabled: { BOOL: true } } }] },
            notify: { M: { type: { S: "email" }, recipient: { S: "a@b.c" } } },
            meta: { M: { createdAt: { S: "2026-10-01T00:00:00.000Z" }, createdBy: { S: "owner-1" } } }
          }
        }
      },
      { ruleId: { S: rule.id }, metadata: { S: "sensor#s" }, schemaVersion: { N: "2" }, sensorId: { S: "s" } }
    ];
    expect(readOk(raw)).toEqual(rule);
    expect(isNewLayout(raw)).toBe(true);
  });

  it("writes one definition item and one index item per sensor, outside the GSIs they do not belong to", () => {
    const written = toWriteSet(v2Rule());
    if (!written.ok) throw new Error(written.errors.join("; "));
    const [definition, ...indexItems] = written.data.puts;
    expect(definition).toMatchObject({ ruleId: "rule-v2", metadata: "definition", schemaVersion: 2, ownerId: "owner-1" });
    expect(definition).not.toHaveProperty("sensorId");
    expect(definition).not.toHaveProperty("condition");
    expect(indexItems).toEqual([
      { ruleId: "rule-v2", metadata: "sensor#sensor-a", schemaVersion: 2, sensorId: "sensor-a" },
      { ruleId: "rule-v2", metadata: "sensor#sensor-b", schemaVersion: 2, sensorId: "sensor-b" },
      { ruleId: "rule-v2", metadata: "sensor#sensor-c", schemaVersion: 2, sensorId: "sensor-c", condition: "no-data" }
    ]);
    expect(indexItems.every((item) => !("ownerId" in item))).toBe(true);
    expect(written.data.deletes).toEqual([]);
  });

  it("drops undefined members and does not share objects with the caller", () => {
    const rule = { ...v2Rule(), areaId: undefined } as unknown as RuleObject;
    const written = toWriteSet(rule);
    if (!written.ok) throw new Error(written.errors.join("; "));
    const stored = written.data.puts[0] as { rule: RuleObject };
    expect("areaId" in stored.rule).toBe(false);
    expect(stored.rule.groups).not.toBe(rule.groups);
  });

  it("deletes the index item of a sensor the rule no longer references", () => {
    const before = toWriteSet(v2Rule());
    if (!before.ok) throw new Error(before.errors.join("; "));
    const after = v2Rule({ groups: [{ id: "g1", mode: "all", conditions: [comparison(1, "sensor-a")] }] });
    const previous = [...before.data.puts, { ruleId: "rule-v2", metadata: "state", version: 3 }];

    const written = toWriteSet(after, previous);
    if (!written.ok) throw new Error(written.errors.join("; "));
    expect(written.data.puts.map((item) => item.metadata)).toEqual(["definition", "sensor#sensor-a"]);
    expect(written.data.deletes).toEqual([
      { ruleId: "rule-v2", metadata: "sensor#sensor-b" },
      { ruleId: "rule-v2", metadata: "sensor#sensor-c" }
    ]);
  });

  it("ignores index and Rule State items when reading", () => {
    const written = toWriteSet(v2Rule());
    if (!written.ok) throw new Error(written.errors.join("; "));
    const items = [{ ruleId: "rule-v2", metadata: "state", triggered: true }, ...written.data.puts.slice().reverse()];
    expect(readOk(items)).toEqual(v2Rule());
  });

  it("refuses schema versions newer than the SDK", () => {
    const written = toWriteSet(v2Rule());
    if (!written.ok) throw new Error(written.errors.join("; "));
    const newer = [{ ...written.data.puts[0], schemaVersion: 3 }];
    expect(readErrors(newer)).toEqual(["Rule rule-v2 uses schemaVersion 3; this SDK supports up to 2"]);
    const overwrite = toWriteSet(v2Rule(), newer);
    expect(overwrite.ok ? [] : overwrite.errors).toEqual(["Rule rule-v2 uses schemaVersion 3; this SDK supports up to 2"]);
  });

  it("rejects invalid input", () => {
    expect(toWriteSet({ ...v2Rule(), cooldownMs: -5 }).ok).toBe(false);
    expect(readErrors([])).toEqual(["Input items must be a non-empty array"]);
    expect(readErrors([{ ruleId: "a", metadata: "name" }, { ruleId: "b", metadata: "owner" }])).toEqual(["Mixed ruleId detected: b vs a"]);
    expect(readErrors([{ ruleId: "rule-v2", metadata: "definition", schemaVersion: 2, rule: { id: "other" } }])).toEqual([
      "Rule rule-v2: definition holds rule other"
    ]);
    expect(readErrors([{ ruleId: "rule-v2", metadata: "definition", schemaVersion: 2 }])).toEqual(["Rule rule-v2: definition item has no rule"]);
    const otherRule = toWriteSet(v2Rule(), [{ ruleId: "someone-else", metadata: "name" }]);
    expect(otherRule.ok ? [] : otherRule.errors).toEqual(["previousItems contain an item of rule someone-else, not rule-v2"]);
  });
});

describe("isNewLayout", () => {
  it("tells the two layouts apart", () => {
    expect(isNewLayout(V1_SINGLE_RULE)).toBe(false);
    expect(isNewLayout(V1_LINE_OBJECT_RULE)).toBe(false);
    const written = toWriteSet(v2Rule());
    if (!written.ok) throw new Error(written.errors.join("; "));
    expect(isNewLayout(written.data.puts)).toBe(true);
    // A converted rule keeps its legacy lastTrigger item; it is still a v2 rule.
    expect(isNewLayout([{ ruleId: "rule-v2", metadata: "lastTrigger", value: "2026-01-01T00:00:00Z" }, ...written.data.puts])).toBe(true);
  });
});

describe("reading legacy rules", () => {
  it("reads a v1 rule as a RuleObject", () => {
    const ruleId = "10762f77-1119-4880-a28f-ba22cc586bda";
    const metadata = "condition-8bfee68d-606a-47c6-bccf-f678d0f9cdee->=";
    expect(readOk(V1_SINGLE_RULE)).toEqual({
      id: ruleId,
      name: "705後方伺服器機櫃濕度監控",
      ownerId: "1321cf85-e3cf-4f48-b6ff-7d668b729305",
      areaId: "9f3ba901-9f46-40f6-81ca-ef93aecb37b0",
      enabled: true,
      cooldownMs: 3600000,
      groupMode: "all",
      groups: [
        {
          id: uuidV5(`${ruleId}/group`),
          mode: "all",
          conditions: [
            {
              id: legacyId(ruleId, metadata),
              sensorId: "8bfee68d-606a-47c6-bccf-f678d0f9cdee",
              name: "濕度過高",
              enabled: true,
              operator: ">=",
              threshold: 75,
              sustain: { type: "count", n: 3 }
            }
          ]
        }
      ],
      ruleControllers: [],
      notify: { type: "email", recipient: "c.crescendo.cat@gmail.com" }
    });
  });

  it("gives legacy conditions the same IDs on every read", () => {
    const first = readOk(V1_SINGLE_RULE);
    const second = readOk([...V1_SINGLE_RULE].reverse());
    expect(second.groups[0]?.conditions[0]?.id).toBe(first.groups[0]?.conditions[0]?.id);
    expect(second.groups[0]?.id).toBe(first.groups[0]?.id);
  });

  it("reads a LINE recipient object and leaves the lastTrigger item to the Rule State", () => {
    const rule = readOk(V1_LINE_OBJECT_RULE);
    expect(rule.notify).toEqual({ type: "line", recipient: { id_type: "user", id_name: "測試用" } });
    expect(rule.cooldownMs).toBe(0);
    expect(rule).not.toHaveProperty("lastTriggerValue");
  });

  it("drops a LINE Notify token, treats an empty duration as absent and defaults ruleMode / cooldown", () => {
    const rule = readOk(V1_LINE_NOTIFY_RULE);
    expect(rule.notify).toBeUndefined();
    expect(rule.areaId).toBeUndefined();
    expect(rule.cooldownMs).toBe(0);
    expect(rule.groups[0]?.mode).toBe("all");
    expect(rule.groups[0]?.conditions[0]).toMatchObject({ operator: ">", threshold: 20, sustain: { type: "count", n: 3 } });
  });

  it("reads rule controllers, enabled unless activate is false", () => {
    expect(readOk(V1_CONTROLLER_RULE).ruleControllers).toEqual([
      { controllerId: "df88f07e-9b54-4add-8c17-a3a99ff2af09", name: "智慧溫室 燈光", value: 3, enabled: true }
    ]);
    const disabled = V1_CONTROLLER_RULE.map((item) => (item.metadata.S.startsWith("controller") ? { ...item, activate: { BOOL: false } } : item));
    expect(readOk(disabled).ruleControllers[0]?.enabled).toBe(false);
  });

  it("reads a rule without conditions as a rule without groups", () => {
    const rule = readOk([
      { ruleId: "r", metadata: "name", name: "789" },
      { ruleId: "r", metadata: "notification", notificationType: "email", notificationValue: "x@example.com" },
      { ruleId: "r", metadata: "owner", ownerId: "owner-1" }
    ]);
    expect(rule.groups).toEqual([]);
  });

  it("maps the legacy sustain settings", () => {
    const base = { ruleId: "r", sensorId: "s", condition: "<", value: 15.5 };
    const owner = { ruleId: "r", metadata: "owner", ownerId: "o" };
    const sustainOf = (condition: Record<string, unknown>) => {
      const rule = readOk([owner, { ...base, metadata: "condition-s-<", ...condition }]);
      return rule.groups[0]?.conditions[0];
    };
    expect(sustainOf({ conditionType: "Duration", conditionUnit: "Percent", conditionLimit: 80, duration: 2 })).toMatchObject({
      threshold: 15.5,
      sustain: { type: "ratio", windowMinutes: 120, percent: 80 }
    });
    // Duration + Times: v2 has no "N times within a window", so the window is dropped.
    expect(sustainOf({ conditionType: "Duration", conditionUnit: "Times", conditionLimit: 4, duration: 3 })).toMatchObject({ sustain: { type: "count", n: 4 } });
    // /api/v2/sensor-rule could write a condition without conditionUnit.
    expect(sustainOf({ conditionType: "Duration", conditionLimit: 2, duration: 1 })).toMatchObject({ sustain: { type: "count", n: 2 } });
    expect(sustainOf({})).toMatchObject({ sustain: { type: "count", n: 1 } });
  });

  it("maps a no-data condition to noDataMinutes", () => {
    const rule = readOk([
      { ruleId: "r", metadata: "owner", ownerId: "o" },
      { ruleId: "r", metadata: "condition-s-no-data", sensorId: "s", condition: "no-data", value: 0, duration: 1.5, conditionType: "-1", conditionUnit: "" }
    ]);
    expect(rule.groups[0]?.conditions[0]).toEqual({ id: legacyId("r", "condition-s-no-data"), sensorId: "s", enabled: true, operator: "no-data", noDataMinutes: 90 });
  });

  it("reports legacy data that cannot be mapped", () => {
    const owner = { ruleId: "r", metadata: "owner", ownerId: "o" };
    const condition = { ruleId: "r", metadata: "condition-s->", sensorId: "s", condition: ">", value: 1 };
    const cases: [unknown[], string][] = [
      [[{ ruleId: "r", metadata: "name", name: "orphan" }], "legacy rule r: legacy rule has no owner item"],
      [[owner, { ...condition, condition: "~" }], "legacy rule r: condition condition-s-> has an unknown operator: ~"],
      [[owner, { ...condition, value: "" }], "legacy rule r: condition condition-s-> has no threshold value"],
      [[owner, { ...condition, sensorId: "" }], "legacy rule r: condition condition-s-> has no sensorId"],
      [[owner, { ...condition, conditionUnit: "Percent", conditionLimit: 50 }], "legacy rule r: condition condition-s-> is a Percent condition without a positive duration"],
      [[owner, { ...condition, conditionUnit: "Percent", conditionLimit: 0, duration: 1 }], "legacy rule r: condition condition-s->.conditionLimit must be greater than 0 and at most 100 for a Percent condition"],
      [[owner, { ...condition, conditionUnit: "Times", conditionLimit: 0 }], "legacy rule r: condition condition-s->.conditionLimit must be a positive integer for a Times condition"],
      [[owner, { ...condition, conditionUnit: "Hours" }], "legacy rule r: condition condition-s->.conditionUnit is unknown: Hours"],
      [[owner, { ...condition, conditionType: "Sometimes" }], "legacy rule r: condition condition-s->.conditionType is unknown: Sometimes"],
      [[owner, { ...condition, value: "abc" }], "legacy rule r: condition condition-s->.value is not a number: abc"],
      [[owner, { ruleId: "r", metadata: "condition-s-no-data", sensorId: "s", condition: "no-data" }], "legacy rule r: condition condition-s-no-data is a no-data condition without a positive duration"],
      [[owner, { ruleId: "r", metadata: "ruleMode", value: "or" }], "legacy rule r: ruleMode is invalid: or"],
      [[owner, { ruleId: "r", metadata: "controller-c1" }], "legacy rule r: controller controller-c1 has no value"],
      [[owner, { ruleId: "r", metadata: "notification", notificationType: "line", notificationValue: { id_type: "room" } }], "legacy rule r: notification has a LINE recipient object without a valid id_type / id_name"]
    ];
    for (const [items, message] of cases) expect(readErrors(items)).toEqual([message]);
  });
});

describe("converting a legacy rule", () => {
  // 20 conditions on 20 sensors and 10 rule controllers: 36 legacy items, far over BatchWrite's 25.
  const ruleId = "big-rule";
  const legacyItems = [
    { ruleId, metadata: "owner", ownerId: "o", areaId: "a" },
    { ruleId, metadata: "name", name: "大規則" },
    { ruleId, metadata: "ruleMode", value: "any" },
    { ruleId, metadata: "minTriggerDuration", value: 60000 },
    { ruleId, metadata: "notification", notificationType: "email", notificationValue: "o@example.com" },
    { ruleId, metadata: "lastTrigger", value: "2026-01-01T00:00:00.000Z" },
    ...Array.from({ length: 20 }, (_, i) => ({ ruleId, metadata: `condition-s${i}->`, sensorId: `s${i}`, condition: ">", value: i, conditionType: "Continual", conditionUnit: "Times", conditionLimit: 2 })),
    ...Array.from({ length: 10 }, (_, i) => ({ ruleId, metadata: `controller-c${i}`, controllerId: `c${i}`, value: 30 }))
  ];

  it("fits conditions and rule controllers beyond 25 into one transaction and keeps the lastTrigger item", () => {
    const rule = readOk(legacyItems);
    expect(rule.groups[0]?.conditions).toHaveLength(20);
    expect(rule.ruleControllers).toHaveLength(10);

    const written = toWriteSet(rule, legacyItems);
    if (!written.ok) throw new Error(written.errors.join("; "));
    expect(written.data.puts).toHaveLength(21);
    expect(written.data.deletes).toHaveLength(35);
    expect(written.data.deletes).not.toContainEqual({ ruleId, metadata: "lastTrigger" });

    const transactItems = toTransactWriteItems(written.data, "SensorRule-test");
    expect(transactItems).toHaveLength(56);
    expect(transactItems.length).toBeLessThanOrEqual(MAX_TRANSACTION_ACTIONS);
    expect(transactItems[0]).toMatchObject({ Put: { TableName: "SensorRule-test", Item: { metadata: "definition" } } });
    expect(transactItems[55]).toMatchObject({ Delete: { TableName: "SensorRule-test", Key: { ruleId } } });

    // After the transaction the table holds the puts plus the kept lastTrigger item: still the same rule.
    const after = [...written.data.puts, legacyItems[5]];
    expect(readOk(after)).toEqual(rule);
    expect(isNewLayout(after)).toBe(true);
  });

  it("refuses a write that would not fit in one transaction", () => {
    const rule = readOk(legacyItems);
    const many = Array.from({ length: 90 }, (_, i) => ({ ruleId, metadata: `junk-${i}` }));
    const written = toWriteSet(rule, [...legacyItems, ...many]);
    expect(written.ok ? [] : written.errors).toEqual(["Writing rule big-rule needs 146 actions; one transaction allows at most 100"]);
  });
});
