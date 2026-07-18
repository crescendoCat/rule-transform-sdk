import type {
  ConditionType,
  ConditionUnit,
  RuleConditionItem,
  RuleControllerItem,
  RuleItem,
  RuleNotify,
  RuleObject,
  TransformResult,
  ValidationResult
} from "./types";

const CONDITION_SET = new Set([">", "<", "=", ">=", "<=", "!=", "no-data"]);
const CONDITION_TYPE_SET = new Set(["Continual", "Duration", "-1"]);
const CONDITION_UNIT_SET = new Set(["Percent", "Times"]);
const DDB_ATTRIBUTE_KEYS = new Set(["S", "N", "BOOL", "NULL", "M", "L", "SS", "NS", "B", "BS"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDdbAttributeValue(value: unknown): value is Record<string, unknown> {
  if (!isObject(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 1) return false;
  const key = keys[0];
  if (!key) return false;
  return DDB_ATTRIBUTE_KEYS.has(key);
}

function unwrapDdbAttributeValue(value: unknown): unknown {
  if (!isDdbAttributeValue(value)) return value;

  if ("S" in value) return value.S;
  if ("N" in value) {
    const n = Number(value.N);
    return Number.isNaN(n) ? value.N : n;
  }
  if ("BOOL" in value) return value.BOOL;
  if ("NULL" in value) return null;
  if ("M" in value && isObject(value.M)) {
    const mapped: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value.M)) {
      mapped[key] = unwrapDdbAttributeValue(child);
    }
    return mapped;
  }
  if ("L" in value && Array.isArray(value.L)) {
    return value.L.map((child) => unwrapDdbAttributeValue(child));
  }
  if ("SS" in value && Array.isArray(value.SS)) return value.SS;
  if ("NS" in value && Array.isArray(value.NS)) {
    return value.NS.map((entry) => {
      const n = Number(entry);
      return Number.isNaN(n) ? entry : n;
    });
  }

  return value;
}

function normalizeRawItem(item: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(item)) {
    normalized[key] = unwrapDdbAttributeValue(value);
  }
  return normalized;
}

function fail<T>(...errors: string[]): TransformResult<T> {
  return { ok: false, errors };
}

function parseNumber(value: unknown, fieldName: string): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }
  throw new Error(`Invalid number in ${fieldName}: ${String(value)}`);
}

function normalizeNotify(item: Record<string, unknown>): RuleNotify {
  const type = (item.notificationType ?? item.notification_type) as string | undefined;
  const detail = item.notificationValue ?? item.notification_detail;

  if (!type) {
    throw new Error("Notification item missing notificationType/notification_type");
  }
  if (detail == null) {
    throw new Error("Notification item missing notificationValue/notification_detail");
  }

  return {
    notificationType: type,
    notificationValue: detail as RuleNotify["notificationValue"]
  };
}

function normalizeCondition(raw: Record<string, unknown>): RuleConditionItem {
  const metadata = String(raw.metadata ?? "");
  const condition = String(raw.condition ?? "");
  if (!metadata.startsWith("condition")) {
    throw new Error(`Invalid condition metadata: ${metadata}`);
  }
  if (!CONDITION_SET.has(condition)) {
    throw new Error(`Unknown condition operator: ${condition}`);
  }
  if (typeof raw.sensorId !== "string" || raw.sensorId.length === 0) {
    throw new Error("Condition item missing sensorId");
  }

  const result: RuleConditionItem = {
    ruleId: String(raw.ruleId ?? ""),
    metadata,
    sensorId: raw.sensorId,
    condition: condition as RuleConditionItem["condition"]
  };

  if (raw.value != null) {
    result.value = parseNumber(raw.value, "condition.value");
  }
  if (raw.duration != null) {
    result.duration = parseNumber(raw.duration, "condition.duration");
  }
  if (raw.conditionLimit != null) {
    result.conditionLimit = parseNumber(raw.conditionLimit, "condition.conditionLimit");
  }

  if (raw.conditionType != null) {
    const conditionType = String(raw.conditionType);
    if (!CONDITION_TYPE_SET.has(conditionType)) {
      throw new Error(`Unknown conditionType: ${conditionType}`);
    }
    result.conditionType = conditionType as ConditionType;
  }

  if (raw.conditionUnit != null) {
    const conditionUnit = String(raw.conditionUnit);
    if (!CONDITION_UNIT_SET.has(conditionUnit)) {
      throw new Error(`Unknown conditionUnit: ${conditionUnit}`);
    }
    result.conditionUnit = conditionUnit as ConditionUnit;
  }

  return result;
}

export function fromDdbItems(items: RuleItem[]): TransformResult<RuleObject> {
  try {
    if (!Array.isArray(items) || items.length === 0) {
      return fail("Input items must be a non-empty array");
    }

    const first = normalizeRawItem(items[0] as unknown as Record<string, unknown>);
    const ruleId = String(first.ruleId ?? "");
    if (!ruleId) return fail("Missing ruleId in input items");

    const rule: RuleObject = {
      Id: ruleId,
      minTriggerDuration: -1,
      lastTriggerValue: null,
      name: "",
      conditions: [],
      ruleMode: "and",
      owner: null,
      controllers: {}
    };

    for (const item of items) {
      const raw = normalizeRawItem(item as unknown as Record<string, unknown>);
      const metadata = String(raw.metadata ?? "");

      if (String(raw.ruleId ?? "") !== ruleId) {
        throw new Error(`Mixed ruleId detected: ${String(raw.ruleId)} vs ${ruleId}`);
      }

      if (metadata.startsWith("condition")) {
        rule.conditions.push(normalizeCondition(raw));
        continue;
      }

      if (metadata === "notification") {
        rule.notify = normalizeNotify(raw);
        continue;
      }

      if (metadata === "name") {
        rule.name = String(raw.name ?? "");
        continue;
      }

      if (metadata === "lastTrigger") {
        const iso = String(raw.value ?? "");
        rule.lastTriggerValue = iso ? new Date(iso) : null;
        continue;
      }

      if (metadata === "minTriggerDuration") {
        rule.minTriggerDuration = parseNumber(raw.value, "minTriggerDuration.value");
        continue;
      }

      if (metadata === "owner") {
        rule.owner = raw.ownerId ? String(raw.ownerId) : null;
        continue;
      }

      if (metadata === "ruleMode") {
        const value = String(raw.value ?? "");
        if (value !== "or" && value !== "and") {
          throw new Error(`Invalid ruleMode: ${value}`);
        }
        rule.ruleMode = value;
        continue;
      }

      if (metadata.startsWith("controller")) {
        const controllerId = metadata.slice(11);
        const controller = raw as unknown as RuleControllerItem;
        const isInactive = controller.activate != null && controller.activate === false;
        if (!isInactive) {
          rule.controllers[controllerId] = parseNumber(raw.value, "controller.value");
        }
      }
    }

    const validation = validateRuleObject(rule);
    if (!validation.ok) return fail(...validation.errors);
    return { ok: true, data: rule };
  } catch (error) {
    return fail((error as Error).message);
  }
}

export function toDdbItems(ruleObject: RuleObject): TransformResult<RuleItem[]> {
  try {
    const validation = validateRuleObject(ruleObject);
    if (!validation.ok) return fail(...validation.errors);

    const ruleId = ruleObject.Id;
    const items: RuleItem[] = [];

    items.push({
      ruleId,
      metadata: "name",
      name: ruleObject.name
    });

    items.push({
      ruleId,
      metadata: "ruleMode",
      value: ruleObject.ruleMode
    });

    items.push({
      ruleId,
      metadata: "minTriggerDuration",
      value: ruleObject.minTriggerDuration
    });

    if (ruleObject.lastTriggerValue) {
      items.push({
        ruleId,
        metadata: "lastTrigger",
        value: ruleObject.lastTriggerValue.toISOString()
      });
    }

    if (ruleObject.owner) {
      items.push({
        ruleId,
        metadata: "owner",
        ownerId: ruleObject.owner
      });
    }

    if (ruleObject.notify) {
      items.push({
        ruleId,
        metadata: "notification",
        notificationType: ruleObject.notify.notificationType,
        notificationValue: ruleObject.notify.notificationValue
      });
    }

    ruleObject.conditions.forEach((condition, index) => {
      const conditionItem: RuleConditionItem = {
        ruleId,
        metadata: condition.metadata || `condition-${String(index + 1).padStart(3, "0")}`,
        sensorId: condition.sensorId,
        condition: condition.condition
      };

      if (condition.value != null) conditionItem.value = condition.value;
      if (condition.conditionType != null) conditionItem.conditionType = condition.conditionType;
      if (condition.duration != null) conditionItem.duration = condition.duration;
      if (condition.conditionUnit != null) conditionItem.conditionUnit = condition.conditionUnit;
      if (condition.conditionLimit != null) conditionItem.conditionLimit = condition.conditionLimit;

      items.push(conditionItem);
    });

    Object.entries(ruleObject.controllers).forEach(([controllerId, value]) => {
      items.push({
        ruleId,
        metadata: `controller-${controllerId}`,
        controllerId,
        value
      });
    });

    return { ok: true, data: items };
  } catch (error) {
    return fail((error as Error).message);
  }
}

export function validateRuleObject(ruleObject: unknown): ValidationResult {
  const errors: string[] = [];
  const rule = ruleObject as Partial<RuleObject>;

  if (!rule || typeof rule !== "object") {
    return { ok: false, errors: ["RuleObject must be an object"] };
  }

  if (!rule.Id || typeof rule.Id !== "string") errors.push("RuleObject.Id is required");
  if (typeof rule.name !== "string") errors.push("RuleObject.name must be string");
  if (rule.ruleMode !== "and" && rule.ruleMode !== "or") errors.push("RuleObject.ruleMode must be 'and' or 'or'");
  if (!Array.isArray(rule.conditions)) errors.push("RuleObject.conditions must be an array");

  if (Array.isArray(rule.conditions)) {
    rule.conditions.forEach((condition, index) => {
      if (!condition.sensorId) errors.push(`conditions[${index}] missing sensorId`);
      if (!CONDITION_SET.has(condition.condition)) errors.push(`conditions[${index}] invalid condition operator`);
      if (condition.conditionType && !CONDITION_TYPE_SET.has(condition.conditionType)) {
        errors.push(`conditions[${index}] invalid conditionType`);
      }
      if (condition.conditionUnit && !CONDITION_UNIT_SET.has(condition.conditionUnit)) {
        errors.push(`conditions[${index}] invalid conditionUnit`);
      }
    });
  }

  if (!rule.controllers || typeof rule.controllers !== "object") {
    errors.push("RuleObject.controllers must be an object");
  }

  return { ok: errors.length === 0, errors };
}

export function normalizeRuleObject(ruleObject: RuleObject): RuleObject {
  return {
    ...ruleObject,
    minTriggerDuration: Number.isFinite(ruleObject.minTriggerDuration) ? ruleObject.minTriggerDuration : -1,
    lastTriggerValue: ruleObject.lastTriggerValue instanceof Date ? ruleObject.lastTriggerValue : null,
    ruleMode: ruleObject.ruleMode === "or" ? "or" : "and",
    owner: ruleObject.owner ?? null,
    controllers: { ...(ruleObject.controllers ?? {}) },
    conditions: [...(ruleObject.conditions ?? [])]
  };
}

export * from "./types";
