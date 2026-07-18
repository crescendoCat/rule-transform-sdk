import { describe, expect, it } from "vitest";
import { fromDdbItems, toDdbItems } from "../src/index";
import type { RuleItem } from "../src/types";

describe("rule-transform-sdk", () => {
  it("transforms DynamoDB items to RuleObject", () => {
    const items: RuleItem[] = [
      { ruleId: "rule-1", metadata: "name", name: "High Temp" },
      { ruleId: "rule-1", metadata: "owner", ownerId: "owner-1" },
      { ruleId: "rule-1", metadata: "ruleMode", value: "all" },
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
    expect(result.data.controllers.some((controller) => controller.controllerId === "controller-1" && controller.value === 120)).toBe(true);
    expect(result.data.conditions.length).toBe(1);
  });

  it("round-trips RuleObject back to items", () => {
    const source: RuleItem[] = [
      { ruleId: "rule-2", metadata: "name", name: "Low Moisture" },
      { ruleId: "rule-2", metadata: "owner", ownerId: "owner-2" },
      { ruleId: "rule-2", metadata: "ruleMode", value: "any" },
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

  it("handles ddbClient raw items", () => {
    const rawItems = [{"conditionLimit":{"S":"3"},"value":{"S":"30"},"metadata":{"S":"condition-4cf300a6-c282-416c-9a8e-c2d429ed646b->="},"conditionUnit":{"S":"Times"},"condition":{"S":">="},"sensorId":{"S":"4cf300a6-c282-416c-9a8e-c2d429ed646b"},"conditionType":{"S":"Continual"},"ruleId":{"S":"315c0292-8f16-4460-bcde-0e7134b657ed"},"conditionName":{"S":"溫度過高"}},{"value":{"S":"2026-07-18T06:40:57.276Z"},"metadata":{"S":"lastTrigger"},"ruleId":{"S":"315c0292-8f16-4460-bcde-0e7134b657ed"}},{"value":{"S":"0"},"metadata":{"S":"minTriggerDuration"},"ruleId":{"S":"315c0292-8f16-4460-bcde-0e7134b657ed"}},{"name":{"S":"705後方伺服器機櫃溫度監控"},"metadata":{"S":"name"},"ruleId":{"S":"315c0292-8f16-4460-bcde-0e7134b657ed"}},{"notificationType":{"S":"line"},"metadata":{"S":"notification"},"ruleId":{"S":"315c0292-8f16-4460-bcde-0e7134b657ed"},"lineTokenCreatedAt":{"S":"none"},"notificationValue":{"M":{"id_name":{"S":"測試用"},"id_type":{"S":"user"}}}},{"metadata":{"S":"owner"},"ruleId":{"S":"315c0292-8f16-4460-bcde-0e7134b657ed"},"areaId":{"S":"9f3ba901-9f46-40f6-81ca-ef93aecb37b0"},"ownerId":{"S":"1321cf85-e3cf-4f48-b6ff-7d668b729305"}}]

    const result = fromDdbItems(rawItems as any);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.Id).toBe("315c0292-8f16-4460-bcde-0e7134b657ed");
    expect(result.data.name).toBe("705後方伺服器機櫃溫度監控");
  });
});
