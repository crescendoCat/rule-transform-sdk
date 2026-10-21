import type { ValidationResult } from "./types";

const COMPARISON_OPERATORS = new Set([">", "<", "=", ">=", "<=", "!="]);
const GROUP_MODES = new Set(["any", "all"]);
const LINE_ID_TYPES = new Set(["user", "group"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Errors = string[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositive(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function checkOptionalString(errors: Errors, value: unknown, path: string): void {
  if (value !== undefined && typeof value !== "string") errors.push(`${path} must be a string`);
}

function checkSustain(errors: Errors, sustain: unknown, path: string): void {
  if (!isRecord(sustain)) {
    errors.push(`${path} is required`);
    return;
  }
  switch (sustain.type) {
    case "count":
      if (!Number.isInteger(sustain.n) || (sustain.n as number) < 1) {
        errors.push(`${path}.n must be a positive integer`);
      }
      return;
    case "ratio":
      if (!isPositive(sustain.windowMinutes)) errors.push(`${path}.windowMinutes must be a positive number`);
      if (!isPositive(sustain.percent) || sustain.percent > 100) {
        errors.push(`${path}.percent must be greater than 0 and at most 100`);
      }
      return;
    case "continuous":
      if (!isPositive(sustain.minutes)) errors.push(`${path}.minutes must be a positive number`);
      return;
    default:
      errors.push(`${path}.type must be 'count', 'ratio' or 'continuous'`);
  }
}

function checkCondition(errors: Errors, condition: unknown, path: string, seenIds: Set<string>): void {
  if (!isRecord(condition)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (!isNonEmptyString(condition.id) || !UUID_PATTERN.test(condition.id)) {
    errors.push(`${path}.id must be a UUID`);
  } else if (seenIds.has(condition.id)) {
    errors.push(`${path}.id duplicates another condition`);
  } else {
    seenIds.add(condition.id);
  }
  if (!isNonEmptyString(condition.sensorId)) errors.push(`${path}.sensorId is required`);
  if (typeof condition.enabled !== "boolean") errors.push(`${path}.enabled must be a boolean`);
  checkOptionalString(errors, condition.name, `${path}.name`);

  if (condition.operator === "no-data") {
    if (!isPositive(condition.noDataMinutes)) errors.push(`${path}.noDataMinutes must be a positive number`);
    for (const field of ["threshold", "recoveryThreshold", "sustain"]) {
      if (condition[field] !== undefined) errors.push(`${path}.${field} does not apply to a no-data condition`);
    }
    return;
  }
  if (typeof condition.operator !== "string" || !COMPARISON_OPERATORS.has(condition.operator)) {
    errors.push(`${path}.operator must be one of <, >, =, <=, >=, !=, no-data`);
    return;
  }
  if (!isFiniteNumber(condition.threshold)) errors.push(`${path}.threshold must be a number`);
  if (condition.recoveryThreshold !== undefined && !isFiniteNumber(condition.recoveryThreshold)) {
    errors.push(`${path}.recoveryThreshold must be a number`);
  }
  if (condition.noDataMinutes !== undefined) {
    errors.push(`${path}.noDataMinutes only applies to a no-data condition`);
  }
  checkSustain(errors, condition.sustain, `${path}.sustain`);
}

function checkGroups(errors: Errors, groups: unknown): void {
  if (!Array.isArray(groups)) {
    errors.push("RuleObject.groups must be an array");
    return;
  }
  const groupIds = new Set<string>();
  const conditionIds = new Set<string>();
  groups.forEach((group: unknown, index) => {
    const path = `groups[${index}]`;
    if (!isRecord(group)) {
      errors.push(`${path} must be an object`);
      return;
    }
    if (!isNonEmptyString(group.id)) {
      errors.push(`${path}.id is required`);
    } else if (groupIds.has(group.id)) {
      errors.push(`${path}.id duplicates another group`);
    } else {
      groupIds.add(group.id);
    }
    if (typeof group.mode !== "string" || !GROUP_MODES.has(group.mode)) {
      errors.push(`${path}.mode must be 'any' or 'all'`);
    }
    if (!Array.isArray(group.conditions) || group.conditions.length === 0) {
      errors.push(`${path}.conditions must be a non-empty array`);
      return;
    }
    group.conditions.forEach((condition: unknown, conditionIndex) => {
      checkCondition(errors, condition, `${path}.conditions[${conditionIndex}]`, conditionIds);
    });
  });
}

function checkRuleControllers(errors: Errors, ruleControllers: unknown): void {
  if (!Array.isArray(ruleControllers)) {
    errors.push("RuleObject.ruleControllers must be an array");
    return;
  }
  const seen = new Set<string>();
  ruleControllers.forEach((controller: unknown, index) => {
    const path = `ruleControllers[${index}]`;
    if (!isRecord(controller)) {
      errors.push(`${path} must be an object`);
      return;
    }
    if (!isNonEmptyString(controller.controllerId)) {
      errors.push(`${path}.controllerId is required`);
    } else if (seen.has(controller.controllerId)) {
      errors.push(`${path}.controllerId duplicates another rule controller`);
    } else {
      seen.add(controller.controllerId);
    }
    checkOptionalString(errors, controller.name, `${path}.name`);
    if (!isFiniteNumber(controller.value)) errors.push(`${path}.value must be a number`);
    if (typeof controller.enabled !== "boolean") errors.push(`${path}.enabled must be a boolean`);
  });
}

function checkNotify(errors: Errors, notify: unknown): void {
  if (notify === undefined) return;
  if (!isRecord(notify)) {
    errors.push("RuleObject.notify must be an object");
    return;
  }
  const recipient = notify.recipient;
  switch (notify.type) {
    case "line":
      if (!isRecord(recipient)) {
        errors.push("notify.recipient of a line notification must be an { id_type, id_name } object");
        return;
      }
      if (typeof recipient.id_type !== "string" || !LINE_ID_TYPES.has(recipient.id_type)) {
        errors.push("notify.recipient.id_type must be 'user' or 'group'");
      }
      if (!isNonEmptyString(recipient.id_name)) errors.push("notify.recipient.id_name is required");
      return;
    case "email":
    case "telegram":
      if (!isNonEmptyString(recipient)) errors.push(`notify.recipient of a ${notify.type} notification must be a non-empty string`);
      return;
    default:
      errors.push("notify.type must be 'line', 'email' or 'telegram'");
  }
}

function checkMeta(errors: Errors, meta: unknown): void {
  if (meta === undefined) return;
  if (!isRecord(meta)) {
    errors.push("RuleObject.meta must be an object");
    return;
  }
  for (const field of ["createdAt", "updatedAt", "createdBy"]) {
    checkOptionalString(errors, meta[field], `meta.${field}`);
  }
}

/**
 * Validates a v2 `RuleObject`. Returns every problem found, with a path to the field.
 * Values are only checked, never converted (thresholds keep their decimals).
 */
export function validateRuleObject(ruleObject: unknown): ValidationResult {
  if (!isRecord(ruleObject)) return { ok: false, errors: ["RuleObject must be an object"] };
  const rule = ruleObject;
  const errors: Errors = [];

  if ("lastTriggerValue" in rule) {
    errors.push("RuleObject.lastTriggerValue is not part of RuleObject; the last trigger time belongs to the Rule State");
  }
  if (!isNonEmptyString(rule.id)) errors.push("RuleObject.id is required");
  if (typeof rule.name !== "string") errors.push("RuleObject.name must be a string");
  if (!isNonEmptyString(rule.ownerId)) errors.push("RuleObject.ownerId is required");
  if (rule.areaId !== undefined && !isNonEmptyString(rule.areaId)) errors.push("RuleObject.areaId must be a non-empty string");
  if (typeof rule.enabled !== "boolean") errors.push("RuleObject.enabled must be a boolean");
  if (!isFiniteNumber(rule.cooldownMs) || rule.cooldownMs < 0) errors.push("RuleObject.cooldownMs must be a number >= 0");
  if (typeof rule.groupMode !== "string" || !GROUP_MODES.has(rule.groupMode)) {
    errors.push("RuleObject.groupMode must be 'any' or 'all'");
  }
  checkGroups(errors, rule.groups);
  checkRuleControllers(errors, rule.ruleControllers);
  checkNotify(errors, rule.notify);
  checkMeta(errors, rule.meta);

  return { ok: errors.length === 0, errors };
}
