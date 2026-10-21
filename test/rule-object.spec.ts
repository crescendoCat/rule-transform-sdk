import { describe, expect, expectTypeOf, it } from "vitest";
import { validateRuleObject } from "../src/index";
import type { ComparisonCondition, Condition, NoDataCondition, RuleObject, Sustain } from "../src/index";

const CONDITION_A = "11111111-1111-4111-8111-111111111111";
const CONDITION_B = "22222222-2222-4222-8222-222222222222";

function comparison(overrides: Partial<ComparisonCondition> = {}): ComparisonCondition {
  return {
    id: CONDITION_A,
    sensorId: "sensor-1",
    operator: ">",
    threshold: 30,
    enabled: true,
    sustain: { type: "count", n: 3 },
    ...overrides
  };
}

function rule(overrides: Partial<RuleObject> = {}, conditions: Condition[] = [comparison()]): RuleObject {
  return {
    id: "rule-1",
    name: "溫室高溫",
    ownerId: "owner-1",
    areaId: "area-1",
    enabled: true,
    cooldownMs: 600000,
    groupMode: "any",
    groups: [{ id: "group-1", mode: "all", conditions }],
    ruleControllers: [{ controllerId: "controller-1", name: "風扇", value: 120, enabled: true }],
    notify: { type: "email", recipient: "owner@example.com" },
    meta: { createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-02T00:00:00.000Z", createdBy: "owner-1" },
    ...overrides
  };
}

function errorsOf(input: unknown): string[] {
  const result = validateRuleObject(input);
  return result.errors;
}

describe("RuleObject v2", () => {
  it("does not carry the last trigger time (it belongs to the Rule State)", () => {
    expectTypeOf<RuleObject>().not.toHaveProperty("lastTriggerValue");
    expect(errorsOf({ ...rule(), lastTriggerValue: null })).toEqual([
      "RuleObject.lastTriggerValue is not part of RuleObject; the last trigger time belongs to the Rule State"
    ]);
  });
});

describe("validateRuleObject", () => {
  it("accepts a complete rule", () => {
    expect(validateRuleObject(rule())).toEqual({ ok: true, errors: [] });
  });

  it("accepts a rule without optional fields and without groups", () => {
    const minimal: RuleObject = {
      id: "rule-2",
      name: "",
      ownerId: "owner-1",
      enabled: false,
      cooldownMs: 0,
      groupMode: "all",
      groups: [],
      ruleControllers: []
    };
    expect(validateRuleObject(minimal).ok).toBe(true);
  });

  it("rejects non-objects", () => {
    expect(errorsOf(null)).toEqual(["RuleObject must be an object"]);
    expect(errorsOf([])).toEqual(["RuleObject must be an object"]);
  });

  it("reports every missing rule-level field", () => {
    expect(errorsOf({})).toEqual([
      "RuleObject.id is required",
      "RuleObject.name must be a string",
      "RuleObject.ownerId is required",
      "RuleObject.enabled must be a boolean",
      "RuleObject.cooldownMs must be a number >= 0",
      "RuleObject.groupMode must be 'any' or 'all'",
      "RuleObject.groups must be an array",
      "RuleObject.ruleControllers must be an array"
    ]);
  });

  it("rejects a negative cooldown and an empty areaId", () => {
    expect(errorsOf(rule({ cooldownMs: -1, areaId: "" }))).toEqual([
      "RuleObject.areaId must be a non-empty string",
      "RuleObject.cooldownMs must be a number >= 0"
    ]);
  });

  it("keeps decimal thresholds as they are", () => {
    const input = rule({}, [comparison({ threshold: 23.75, recoveryThreshold: 22.5 })]);
    expect(validateRuleObject(input).ok).toBe(true);
    const condition = input.groups[0]?.conditions[0] as ComparisonCondition;
    expect(condition.threshold).toBe(23.75);
    expect(condition.recoveryThreshold).toBe(22.5);
  });

  describe("condition groups", () => {
    it("rejects an empty group", () => {
      expect(errorsOf(rule({}, []))).toEqual(["groups[0].conditions must be a non-empty array"]);
    });

    it("rejects a bad group mode and duplicate group ids", () => {
      const input = rule({
        groups: [
          { id: "g", mode: "all", conditions: [comparison()] },
          { id: "g", mode: "some" as "all", conditions: [comparison({ id: CONDITION_B })] }
        ]
      });
      expect(errorsOf(input)).toEqual(["groups[1].id duplicates another group", "groups[1].mode must be 'any' or 'all'"]);
    });

    it("rejects condition ids that are not UUIDs or repeat across groups", () => {
      const input = rule({
        groups: [
          { id: "g1", mode: "all", conditions: [comparison({ id: "condition-sensor-1->" })] },
          { id: "g2", mode: "any", conditions: [comparison(), comparison()] }
        ]
      });
      expect(errorsOf(input)).toEqual([
        "groups[0].conditions[0].id must be a UUID",
        "groups[1].conditions[1].id duplicates another condition"
      ]);
    });
  });

  describe("sustain", () => {
    const valid: Sustain[] = [
      { type: "count", n: 1 },
      { type: "ratio", windowMinutes: 30, percent: 80 },
      { type: "ratio", windowMinutes: 0.5, percent: 100 },
      { type: "continuous", minutes: 15 }
    ];
    it.each(valid)("accepts %j", (sustain) => {
      expect(validateRuleObject(rule({}, [comparison({ sustain })])).ok).toBe(true);
    });

    const invalid: [unknown, string][] = [
      [{ type: "count", n: 0 }, "sustain.n must be a positive integer"],
      [{ type: "count", n: 2.5 }, "sustain.n must be a positive integer"],
      [{ type: "count", n: "3" }, "sustain.n must be a positive integer"],
      [{ type: "ratio", windowMinutes: 0, percent: 50 }, "sustain.windowMinutes must be a positive number"],
      [{ type: "ratio", windowMinutes: 10, percent: 0 }, "sustain.percent must be greater than 0 and at most 100"],
      [{ type: "ratio", windowMinutes: 10, percent: 101 }, "sustain.percent must be greater than 0 and at most 100"],
      [{ type: "ratio", windowMinutes: 10, percent: -5 }, "sustain.percent must be greater than 0 and at most 100"],
      [{ type: "continuous", minutes: -1 }, "sustain.minutes must be a positive number"],
      [{ type: "continuous" }, "sustain.minutes must be a positive number"],
      [{ type: "window", minutes: 5 }, "sustain.type must be 'count', 'ratio' or 'continuous'"],
      [undefined, "sustain is required"]
    ];
    it.each(invalid)("rejects %j", (sustain, message) => {
      expect(errorsOf(rule({}, [comparison({ sustain: sustain as Sustain })]))).toEqual([
        `groups[0].conditions[0].${message}`
      ]);
    });
  });

  describe("recovery threshold", () => {
    it("is optional", () => {
      const condition = comparison();
      expect("recoveryThreshold" in condition).toBe(false);
      expect(validateRuleObject(rule({}, [condition])).ok).toBe(true);
    });

    it("must be a number when present", () => {
      expect(errorsOf(rule({}, [comparison({ recoveryThreshold: "25" as unknown as number })]))).toEqual([
        "groups[0].conditions[0].recoveryThreshold must be a number"
      ]);
    });
  });

  describe("disabling", () => {
    it("accepts disabled rules, conditions and rule controllers", () => {
      const input = rule(
        { enabled: false, ruleControllers: [{ controllerId: "c", value: 1, enabled: false }] },
        [comparison({ enabled: false })]
      );
      expect(validateRuleObject(input).ok).toBe(true);
    });

    it("requires the enabled flags to be booleans", () => {
      const input = rule(
        { enabled: "yes" as unknown as boolean, ruleControllers: [{ controllerId: "c", value: 1 } as never] },
        [comparison({ enabled: 1 as unknown as boolean })]
      );
      expect(errorsOf(input)).toEqual([
        "RuleObject.enabled must be a boolean",
        "groups[0].conditions[0].enabled must be a boolean",
        "ruleControllers[0].enabled must be a boolean"
      ]);
    });
  });

  describe("conditions", () => {
    it("requires a sensor, a known operator and a numeric threshold", () => {
      const input = rule({}, [comparison({ sensorId: "", threshold: Number.NaN })]);
      expect(errorsOf(input)).toEqual([
        "groups[0].conditions[0].sensorId is required",
        "groups[0].conditions[0].threshold must be a number"
      ]);
      expect(errorsOf(rule({}, [comparison({ operator: "=>" as ">" })]))).toEqual([
        "groups[0].conditions[0].operator must be one of <, >, =, <=, >=, !=, no-data"
      ]);
    });

    it("accepts a no-data condition without a threshold", () => {
      const noData: NoDataCondition = { id: CONDITION_B, sensorId: "sensor-2", operator: "no-data", noDataMinutes: 60, enabled: true };
      expect(validateRuleObject(rule({}, [noData])).ok).toBe(true);
    });

    it("rejects comparison fields on a no-data condition and noDataMinutes on a comparison", () => {
      const noData = { id: CONDITION_B, sensorId: "s", operator: "no-data", enabled: true, threshold: 0, sustain: { type: "count", n: 1 } };
      expect(errorsOf(rule({}, [noData as unknown as Condition]))).toEqual([
        "groups[0].conditions[0].noDataMinutes must be a positive number",
        "groups[0].conditions[0].threshold does not apply to a no-data condition",
        "groups[0].conditions[0].sustain does not apply to a no-data condition"
      ]);
      const mixed = { ...comparison(), noDataMinutes: 5 };
      expect(errorsOf(rule({}, [mixed]))).toEqual(["groups[0].conditions[0].noDataMinutes only applies to a no-data condition"]);
    });
  });

  describe("notify", () => {
    it("accepts a LINE recipient object", () => {
      for (const id_type of ["user", "group"] as const) {
        expect(validateRuleObject(rule({ notify: { type: "line", recipient: { id_type, id_name: "A 區" } } })).ok).toBe(true);
      }
    });

    it("rejects a LINE recipient that is not an { id_type, id_name } object", () => {
      expect(errorsOf(rule({ notify: { type: "line", recipient: "legacy-token" as never } }))).toEqual([
        "notify.recipient of a line notification must be an { id_type, id_name } object"
      ]);
      expect(errorsOf(rule({ notify: { type: "line", recipient: { id_type: "room" as "user", id_name: "" } } }))).toEqual([
        "notify.recipient.id_type must be 'user' or 'group'",
        "notify.recipient.id_name is required"
      ]);
    });

    it("requires a string recipient for email and telegram", () => {
      expect(validateRuleObject(rule({ notify: { type: "telegram", recipient: "123456" } })).ok).toBe(true);
      expect(errorsOf(rule({ notify: { type: "email", recipient: "" } }))).toEqual([
        "notify.recipient of a email notification must be a non-empty string"
      ]);
      expect(errorsOf(rule({ notify: { type: "sms", recipient: "x" } as never }))).toEqual([
        "notify.type must be 'line', 'email' or 'telegram'"
      ]);
    });
  });

  describe("rule controllers", () => {
    it("requires an id, a numeric value and unique controllers", () => {
      const input = rule({
        ruleControllers: [
          { controllerId: "c1", value: 1, enabled: true },
          { controllerId: "c1", value: Number.POSITIVE_INFINITY, enabled: true },
          { controllerId: "", value: 1, enabled: true, name: 5 as unknown as string }
        ]
      });
      expect(errorsOf(input)).toEqual([
        "ruleControllers[1].controllerId duplicates another rule controller",
        "ruleControllers[1].value must be a number",
        "ruleControllers[2].controllerId is required",
        "ruleControllers[2].name must be a string"
      ]);
    });
  });

  it("checks meta fields are strings", () => {
    expect(errorsOf(rule({ meta: { createdAt: 0 as unknown as string } }))).toEqual(["meta.createdAt must be a string"]);
  });
});
