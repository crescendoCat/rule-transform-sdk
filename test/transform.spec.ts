import { describe, expect, it } from "vitest";
import { fromDdbItems, toDdbItems } from "../src/index";
import type { RuleItem } from "../src/types";

describe("rule-transform-sdk", () => {
  it("transforms DynamoDB items to RuleObject", () => {
    const items: RuleItem[] = [
      { ruleId: "rule-1", metadata: "name", name: "High Temp" },
      { ruleId: "rule-1", metadata: "owner", ownerId: "owner-1" },
      { ruleId: "rule-1", metadata: "ruleMode", value: "and" },
      { ruleId: "rule-1", metadata: "minTriggerDuration", value: 300000 },
      {
        ruleId: "rule-1",
        metadata: "notification",
        notification_type: "line",
        notification_detail: { id_type: "group", id_name: "A 區" }
      },
      {
        ruleId: "rule-1",
        metadata: "condition-001",
        sensorId: "sensor-1",
        condition: ">",
        value: 40,
        conditionType: "Continual",
        conditionUnit: "Times",
        conditionLimit: 3
      },
      {
        ruleId: "rule-1",
        metadata: "controller-controller-1",
        value: 120,
        activate: true
      }
    ];

    const result = fromDdbItems(items);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.Id).toBe("rule-1");
    expect(result.data.notify?.notificationType).toBe("line");
    expect(result.data.controllers["controller-1"]).toBe(120);
    expect(result.data.conditions.length).toBe(1);
  });

  it("round-trips RuleObject back to items", () => {
    const source: RuleItem[] = [
      { ruleId: "rule-2", metadata: "name", name: "Low Moisture" },
      { ruleId: "rule-2", metadata: "owner", ownerId: "owner-2" },
      { ruleId: "rule-2", metadata: "ruleMode", value: "or" },
      { ruleId: "rule-2", metadata: "minTriggerDuration", value: 0 },
      {
        ruleId: "rule-2",
        metadata: "condition-001",
        sensorId: "sensor-2",
        condition: "<",
        value: 15,
        conditionType: "Duration",
        conditionUnit: "Percent",
        conditionLimit: 80,
        duration: 2
      }
    ];

    const parsed = fromDdbItems(source);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const written = toDdbItems(parsed.data);
    expect(written.ok).toBe(true);
    if (!written.ok) return;

    expect(written.data.some((item) => item.metadata === "name")).toBe(true);
    expect(written.data.some((item) => String(item.metadata).startsWith("condition"))).toBe(true);
  });
});
