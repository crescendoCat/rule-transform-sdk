import { describe, expect, it } from "vitest";
import { decodeRuleChange, encodeRuleChange, RULE_CHANGE_TOPIC } from "../src/index";
import type { RuleChange, RuleChangeType } from "../src/index";

/** Payload as the legacy API publishes it: JSON.stringify({ type, ruleId, msg, data? }). */
function legacyPayload(type: string, msg: string, data?: unknown): string {
  return JSON.stringify(data === undefined ? { type, ruleId: "r1", msg } : { type, ruleId: "r1", msg, data });
}

describe("ruleChange messages", () => {
  it("keeps the topic", () => {
    expect(RULE_CHANGE_TOPIC).toBe("notifyEngine/ruleChange");
  });

  it.each(["created", "updated", "deleted"] as RuleChangeType[])("round-trips a %s change", (type) => {
    const payload = encodeRuleChange({ type, ruleId: "r1" });
    expect(JSON.parse(payload)).toEqual({ schemaVersion: 2, type, ruleId: "r1" });
    expect(decodeRuleChange(payload)).toEqual({ ok: true, data: { type, ruleId: "r1", format: "v2" } });
  });

  it("decodes a payload given as bytes or as an object", () => {
    const payload = encodeRuleChange({ type: "updated", ruleId: "r1" });
    expect(decodeRuleChange(Buffer.from(payload))).toEqual({ ok: true, data: { type: "updated", ruleId: "r1", format: "v2" } });
    expect(decodeRuleChange(JSON.parse(payload))).toEqual({ ok: true, data: { type: "updated", ruleId: "r1", format: "v2" } });
  });

  // src/legacy/SensorRulev1.js
  const v1Messages: [string, string, RuleChangeType][] = [
    ["add", "add-rule", "created"],
    ["delete", "delete-rule", "deleted"],
    ["update", "update-condition", "updated"],
    ["delete", "delete-condition", "updated"],
    ["update", "update-notification", "updated"],
    ["delete", "delete-notification", "updated"],
    ["delete", "delete-controller", "updated"]
  ];
  it.each(v1Messages)("decodes the v1 message %s / %s", (type, msg, expected) => {
    expect(decodeRuleChange(legacyPayload(type, msg, { metadata: "condition-s1-no-data" }))).toEqual({
      ok: true,
      data: { type: expected, ruleId: "r1", format: "legacy", legacyMessage: msg }
    });
  });

  // src/legacy/sensor-rule (/api/v2/sensor-rule)
  const v2Messages: [string, string, RuleChangeType][] = [
    ["add", "Rule created", "created"],
    ["update", "Rule updated", "updated"],
    ["delete", "Rule deleted", "deleted"],
    ["update", "Condition updated", "updated"],
    ["delete", "Condition deleted", "updated"],
    ["update", "Controller updated", "updated"],
    ["delete", "Controller deleted", "updated"]
  ];
  it.each(v2Messages)("decodes the /api/v2/sensor-rule message %s / %s", (type, msg, expected) => {
    expect(decodeRuleChange(legacyPayload(type, msg))).toEqual({
      ok: true,
      data: { type: expected, ruleId: "r1", format: "legacy", legacyMessage: msg }
    });
  });

  it("falls back on the legacy type when msg is missing or unknown; a bare delete means reload", () => {
    expect(decodeRuleChange(JSON.stringify({ type: "add", ruleId: "r1" }))).toEqual({ ok: true, data: { type: "created", ruleId: "r1", format: "legacy" } });
    expect(decodeRuleChange(legacyPayload("update", "something new"))).toMatchObject({ ok: true, data: { type: "updated", legacyMessage: "something new" } });
    expect(decodeRuleChange(legacyPayload("delete", "delete-something"))).toMatchObject({ ok: true, data: { type: "updated" } });
  });

  it("reports payloads it cannot decode", () => {
    expect(decodeRuleChange("not json")).toMatchObject({ ok: false });
    expect(decodeRuleChange("[1]")).toEqual({ ok: false, errors: ["Cannot parse ruleChange payload: ruleChange payload must be a JSON object"] });
    expect(decodeRuleChange(JSON.stringify({ type: "add", msg: "add-rule" }))).toEqual({ ok: false, errors: ["ruleChange payload has no ruleId"] });
    expect(decodeRuleChange(JSON.stringify({ type: "move", ruleId: "r1", msg: "move-rule" }))).toEqual({
      ok: false,
      errors: ["Unknown legacy ruleChange message: type move, msg move-rule"]
    });
    expect(decodeRuleChange(JSON.stringify({ schemaVersion: 3, type: "created", ruleId: "r1" }))).toEqual({
      ok: false,
      errors: ["ruleChange schemaVersion 3 is not supported"]
    });
    expect(decodeRuleChange(JSON.stringify({ schemaVersion: 2, type: "add", ruleId: "r1" }))).toEqual({ ok: false, errors: ["Unknown rule change type: add"] });
  });

  it("refuses to encode an invalid change", () => {
    expect(() => encodeRuleChange({ type: "add", ruleId: "r1" } as unknown as RuleChange)).toThrow("Unknown rule change type: add");
    expect(() => encodeRuleChange({ type: "created", ruleId: "" })).toThrow("RuleChange.ruleId is required");
  });
});
