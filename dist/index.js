// src/validate.ts
var COMPARISON_OPERATORS = /* @__PURE__ */ new Set([">", "<", "=", ">=", "<=", "!="]);
var GROUP_MODES = /* @__PURE__ */ new Set(["any", "all"]);
var LINE_ID_TYPES = /* @__PURE__ */ new Set(["user", "group"]);
var UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}
function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function isPositive(value) {
  return isFiniteNumber(value) && value > 0;
}
function checkOptionalString(errors, value, path) {
  if (value !== void 0 && typeof value !== "string") errors.push(`${path} must be a string`);
}
function checkSustain(errors, sustain, path) {
  if (!isRecord(sustain)) {
    errors.push(`${path} is required`);
    return;
  }
  switch (sustain.type) {
    case "count":
      if (!Number.isInteger(sustain.n) || sustain.n < 1) {
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
function checkCondition(errors, condition, path, seenIds) {
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
      if (condition[field] !== void 0) errors.push(`${path}.${field} does not apply to a no-data condition`);
    }
    return;
  }
  if (typeof condition.operator !== "string" || !COMPARISON_OPERATORS.has(condition.operator)) {
    errors.push(`${path}.operator must be one of <, >, =, <=, >=, !=, no-data`);
    return;
  }
  if (!isFiniteNumber(condition.threshold)) errors.push(`${path}.threshold must be a number`);
  if (condition.recoveryThreshold !== void 0 && !isFiniteNumber(condition.recoveryThreshold)) {
    errors.push(`${path}.recoveryThreshold must be a number`);
  }
  if (condition.noDataMinutes !== void 0) {
    errors.push(`${path}.noDataMinutes only applies to a no-data condition`);
  }
  checkSustain(errors, condition.sustain, `${path}.sustain`);
}
function checkGroups(errors, groups) {
  if (!Array.isArray(groups)) {
    errors.push("RuleObject.groups must be an array");
    return;
  }
  const groupIds = /* @__PURE__ */ new Set();
  const conditionIds = /* @__PURE__ */ new Set();
  groups.forEach((group, index) => {
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
    group.conditions.forEach((condition, conditionIndex) => {
      checkCondition(errors, condition, `${path}.conditions[${conditionIndex}]`, conditionIds);
    });
  });
}
function checkRuleControllers(errors, ruleControllers) {
  if (!Array.isArray(ruleControllers)) {
    errors.push("RuleObject.ruleControllers must be an array");
    return;
  }
  const seen = /* @__PURE__ */ new Set();
  ruleControllers.forEach((controller, index) => {
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
function checkNotify(errors, notify) {
  if (notify === void 0) return;
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
function checkMeta(errors, meta) {
  if (meta === void 0) return;
  if (!isRecord(meta)) {
    errors.push("RuleObject.meta must be an object");
    return;
  }
  for (const field of ["createdAt", "updatedAt", "createdBy"]) {
    checkOptionalString(errors, meta[field], `meta.${field}`);
  }
}
function validateRuleObject(ruleObject) {
  if (!isRecord(ruleObject)) return { ok: false, errors: ["RuleObject must be an object"] };
  const rule = ruleObject;
  const errors = [];
  if ("lastTriggerValue" in rule) {
    errors.push("RuleObject.lastTriggerValue is not part of RuleObject; the last trigger time belongs to the Rule State");
  }
  if (!isNonEmptyString(rule.id)) errors.push("RuleObject.id is required");
  if (typeof rule.name !== "string") errors.push("RuleObject.name must be a string");
  if (!isNonEmptyString(rule.ownerId)) errors.push("RuleObject.ownerId is required");
  if (rule.areaId !== void 0 && !isNonEmptyString(rule.areaId)) errors.push("RuleObject.areaId must be a non-empty string");
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

// src/legacy.ts
var CONDITION_SET = /* @__PURE__ */ new Set([">", "<", "=", ">=", "<=", "!=", "no-data"]);
var CONDITION_TYPE_SET = /* @__PURE__ */ new Set(["Continual", "Duration", "-1"]);
var CONDITION_UNIT_SET = /* @__PURE__ */ new Set(["Percent", "Times"]);
var DDB_ATTRIBUTE_KEYS = /* @__PURE__ */ new Set(["S", "N", "BOOL", "NULL", "M", "L", "SS", "NS", "B", "BS"]);
function isObject(value) {
  return typeof value === "object" && value !== null;
}
function isDdbAttributeValue(value) {
  if (!isObject(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 1) return false;
  const key = keys[0];
  if (!key) return false;
  return DDB_ATTRIBUTE_KEYS.has(key);
}
function unwrapDdbAttributeValue(value) {
  if (!isDdbAttributeValue(value)) return value;
  if ("S" in value) return value.S;
  if ("N" in value) {
    const n = Number(value.N);
    return Number.isNaN(n) ? value.N : n;
  }
  if ("BOOL" in value) return value.BOOL;
  if ("NULL" in value) return null;
  if ("M" in value && isObject(value.M)) {
    const mapped = {};
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
function normalizeRawItem(item) {
  const normalized = {};
  for (const [key, value] of Object.entries(item)) {
    normalized[key] = unwrapDdbAttributeValue(value);
  }
  return normalized;
}
function fail(...errors) {
  return { ok: false, errors };
}
function parseNumber(value, fieldName) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }
  throw new Error(`Invalid number in ${fieldName}: ${String(value)}`);
}
function normalizeNotify(item) {
  const type = item.notificationType ?? item.notification_type;
  const detail = item.notificationValue ?? item.notification_detail;
  if (!type) {
    throw new Error("Notification item missing notificationType/notification_type");
  }
  if (detail == null) {
    throw new Error("Notification item missing notificationValue/notification_detail");
  }
  return {
    notificationType: type,
    notificationValue: detail
  };
}
function normalizeCondition(raw) {
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
  const result = {
    ruleId: String(raw.ruleId ?? ""),
    metadata,
    sensorId: raw.sensorId,
    condition
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
    result.conditionType = conditionType;
  }
  if (raw.conditionUnit != null) {
    const conditionUnit = String(raw.conditionUnit);
    if (!CONDITION_UNIT_SET.has(conditionUnit)) {
      throw new Error(`Unknown conditionUnit: ${conditionUnit}`);
    }
    result.conditionUnit = conditionUnit;
  }
  return result;
}
function normalizeMeta(raw) {
  const metadata = String(raw.metadata ?? "");
  if (metadata !== "meta") {
    throw new Error(`Invalid meta metadata: ${metadata}`);
  }
  const result = {
    ruleId: String(raw.ruleId ?? ""),
    metadata: "meta"
  };
  if (raw.createdAt != null) {
    result.createdAt = String(raw.createdAt);
  }
  if (raw.updatedAt != null) {
    result.updatedAt = String(raw.updatedAt);
  }
  if (raw.createdBy != null) {
    result.createdBy = String(raw.createdBy);
  }
  return result;
}
function normalizeController(raw) {
  const metadata = String(raw.metadata ?? "");
  if (!metadata.startsWith("controller")) {
    throw new Error(`Invalid controller metadata: ${metadata}`);
  }
  const fromMetadata = metadata.length > 11 ? metadata.slice(11) : "";
  const controllerId = fromMetadata || String(raw.controllerId ?? "");
  if (!controllerId) {
    throw new Error("Controller metadata missing controllerId");
  }
  const result = {
    ruleId: String(raw.ruleId ?? ""),
    metadata,
    controllerId,
    value: parseNumber(raw.value, "controller.value")
  };
  if (raw.controllerName != null) {
    result.controllerName = String(raw.controllerName);
  }
  if (raw.activate != null) {
    result.activate = Boolean(raw.activate);
  }
  return result;
}
function fromLegacyDdbItems(items) {
  try {
    if (!Array.isArray(items) || items.length === 0) {
      return fail("Input items must be a non-empty array");
    }
    const first = normalizeRawItem(items[0]);
    const ruleId = String(first.ruleId ?? "");
    if (!ruleId) return fail("Missing ruleId in input items");
    const rule = {
      Id: ruleId,
      minTriggerDuration: -1,
      lastTriggerValue: null,
      name: "",
      conditions: [],
      ruleMode: "all",
      owner: null,
      controllers: []
    };
    for (const item of items) {
      const raw = normalizeRawItem(item);
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
        if (value !== "all" && value !== "any") {
          throw new Error(`Invalid ruleMode: ${value}`);
        }
        rule.ruleMode = value;
        continue;
      }
      if (metadata.startsWith("controller")) {
        const normalizedControllerObject = normalizeController(raw);
        rule.controllers.push(normalizedControllerObject);
        continue;
      }
      if (metadata === "meta") {
        rule.meta = normalizeMeta(raw);
        continue;
      }
    }
    const validation = validateLegacyRuleObject(rule);
    if (!validation.ok) return fail(...validation.errors);
    return { ok: true, data: rule };
  } catch (error) {
    return fail(error.message);
  }
}
function toLegacyDdbItems(ruleObject) {
  try {
    const validation = validateLegacyRuleObject(ruleObject);
    if (!validation.ok) return fail(...validation.errors);
    const ruleId = ruleObject.Id;
    const items = [];
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
    if (ruleObject.meta) {
      const metaItem = {
        ruleId,
        metadata: "meta"
      };
      if (ruleObject.meta.createdAt != null) metaItem.createdAt = ruleObject.meta.createdAt;
      if (ruleObject.meta.updatedAt != null) metaItem.updatedAt = ruleObject.meta.updatedAt;
      if (ruleObject.meta.createdBy != null) metaItem.createdBy = ruleObject.meta.createdBy;
      items.push(metaItem);
    }
    ruleObject.conditions.forEach((condition, index) => {
      const conditionItem = {
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
    ruleObject.controllers.forEach((controller, index) => {
      const controllerId = controller.controllerId ?? (String(controller.metadata ?? "").startsWith("controller-") ? String(controller.metadata).slice(11) : "");
      if (!controllerId) {
        throw new Error(`controllers[${index}] missing controllerId`);
      }
      const controllerItem = {
        ruleId,
        metadata: `controller-${controllerId}`,
        controllerId,
        value: parseNumber(controller.value, `controllers[${index}].value`)
      };
      if (controller.controllerName != null) {
        controllerItem.controllerName = String(controller.controllerName);
      }
      if (controller.activate != null) {
        controllerItem.activate = Boolean(controller.activate);
      }
      items.push(controllerItem);
    });
    return { ok: true, data: items };
  } catch (error) {
    return fail(error.message);
  }
}
function validateLegacyRuleObject(ruleObject) {
  const errors = [];
  const rule = ruleObject;
  if (!rule || typeof rule !== "object") {
    return { ok: false, errors: ["RuleObject must be an object"] };
  }
  if (!rule.Id || typeof rule.Id !== "string") errors.push("RuleObject.Id is required");
  if (typeof rule.name !== "string") errors.push("RuleObject.name must be string");
  if (rule.ruleMode !== "all" && rule.ruleMode !== "any") errors.push("RuleObject.ruleMode must be 'all' or 'any'");
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
  if (!Array.isArray(rule.controllers)) {
    errors.push("RuleObject.controllers must be an array");
  }
  if (Array.isArray(rule.controllers)) {
    rule.controllers.forEach((controller, index) => {
      if (!controller || typeof controller !== "object") {
        errors.push(`controllers[${index}] must be an object`);
        return;
      }
      const metadata = String(controller.metadata ?? "");
      const derivedControllerId = controller.controllerId ?? (metadata.startsWith("controller-") ? metadata.slice(11) : "");
      if (!derivedControllerId) {
        errors.push(`controllers[${index}] missing controllerId`);
      }
      if (!Number.isFinite(Number(controller.value))) {
        errors.push(`controllers[${index}] invalid value`);
      }
    });
  }
  return { ok: errors.length === 0, errors };
}
function normalizeLegacyRuleObject(ruleObject) {
  return {
    ...ruleObject,
    minTriggerDuration: Number.isFinite(ruleObject.minTriggerDuration) ? ruleObject.minTriggerDuration : -1,
    lastTriggerValue: ruleObject.lastTriggerValue instanceof Date ? ruleObject.lastTriggerValue : null,
    ruleMode: ruleObject.ruleMode === "any" ? "any" : "all",
    owner: ruleObject.owner ?? null,
    controllers: [...ruleObject.controllers ?? []],
    conditions: [...ruleObject.conditions ?? []]
  };
}
export {
  fromLegacyDdbItems,
  normalizeCondition,
  normalizeController,
  normalizeLegacyRuleObject,
  normalizeMeta,
  normalizeNotify,
  normalizeRawItem,
  toLegacyDdbItems,
  validateLegacyRuleObject,
  validateRuleObject
};
