"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  DEFAULT_TABLE_NAME: () => DEFAULT_TABLE_NAME,
  MAX_TRANSACTION_ACTIONS: () => MAX_TRANSACTION_ACTIONS,
  RULE_CHANGE_SCHEMA_VERSION: () => RULE_CHANGE_SCHEMA_VERSION,
  RULE_CHANGE_TOPIC: () => RULE_CHANGE_TOPIC,
  RULE_STATE_METADATA_KEY: () => RULE_STATE_METADATA_KEY,
  decodeRuleChange: () => decodeRuleChange,
  deleteRule: () => deleteRule,
  encodeRuleChange: () => encodeRuleChange,
  findNoDataConditions: () => findNoDataConditions,
  findRulesBySensorId: () => findRulesBySensorId,
  fromDdbItems: () => fromDdbItems,
  fromLegacyDdbItems: () => fromLegacyDdbItems,
  getRule: () => getRule,
  getRuleState: () => getRuleState,
  isNewLayout: () => isNewLayout,
  listRulesByOwner: () => listRulesByOwner,
  normalizeCondition: () => normalizeCondition,
  normalizeController: () => normalizeController,
  normalizeLegacyRuleObject: () => normalizeLegacyRuleObject,
  normalizeMeta: () => normalizeMeta,
  normalizeNotify: () => normalizeNotify,
  normalizeRawItem: () => normalizeRawItem,
  putRule: () => putRule,
  putRuleState: () => putRuleState,
  toLegacyDdbItems: () => toLegacyDdbItems,
  toTransactWriteItems: () => toTransactWriteItems,
  toWriteSet: () => toWriteSet,
  validateLegacyRuleObject: () => validateLegacyRuleObject,
  validateRuleObject: () => validateRuleObject
});
module.exports = __toCommonJS(index_exports);

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

// src/uuid.ts
var import_node_crypto = require("crypto");
var SDK_UUID_NAMESPACE = "9b2f6c1e-5a4d-4e8b-a7c3-2d1f0e9b8a76";
function uuidV5(name, namespace = SDK_UUID_NAMESPACE) {
  const namespaceBytes = Buffer.from(namespace.replace(/-/g, ""), "hex");
  if (namespaceBytes.length !== 16) throw new Error(`Invalid UUID namespace: ${namespace}`);
  const bytes = (0, import_node_crypto.createHash)("sha1").update(namespaceBytes).update(name, "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6] ?? 0) & 15 | 80;
  bytes[8] = (bytes[8] ?? 0) & 63 | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// src/legacy-mapping.ts
var COMPARISON_OPERATORS2 = /* @__PURE__ */ new Set([">", "<", "=", ">=", "<=", "!="]);
var KNOWN_CONDITION_TYPES = /* @__PURE__ */ new Set(["Continual", "Duration", "-1"]);
var LegacyMappingError = class extends Error {
};
function optionalNumber(value, field) {
  if (value === void 0 || value === null || value === "") return void 0;
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) throw new LegacyMappingError(`${field} is not a number: ${String(value)}`);
  return n;
}
function optionalText(value) {
  if (typeof value !== "string") return void 0;
  const trimmed = value.trim();
  return trimmed === "" ? void 0 : trimmed;
}
function mapSustain(raw, where) {
  const unit = optionalText(raw.conditionUnit);
  const limit = optionalNumber(raw.conditionLimit, `${where}.conditionLimit`);
  if (unit === "Percent") {
    const hours = optionalNumber(raw.duration, `${where}.duration`);
    if (hours === void 0 || hours <= 0) {
      throw new LegacyMappingError(`${where} is a Percent condition without a positive duration`);
    }
    if (limit === void 0 || limit <= 0 || limit > 100) {
      throw new LegacyMappingError(`${where}.conditionLimit must be greater than 0 and at most 100 for a Percent condition`);
    }
    return { type: "ratio", windowMinutes: hours * 60, percent: limit };
  }
  if (unit === void 0 || unit === "Times") {
    const n = limit ?? 1;
    if (!Number.isInteger(n) || n < 1) {
      throw new LegacyMappingError(`${where}.conditionLimit must be a positive integer for a Times condition`);
    }
    return { type: "count", n };
  }
  throw new LegacyMappingError(`${where}.conditionUnit is unknown: ${unit}`);
}
function mapCondition(ruleId, raw) {
  const metadata = String(raw.metadata);
  const where = `condition ${metadata}`;
  const sensorId = optionalText(raw.sensorId);
  if (!sensorId) throw new LegacyMappingError(`${where} has no sensorId`);
  const conditionType = optionalText(raw.conditionType);
  if (conditionType !== void 0 && !KNOWN_CONDITION_TYPES.has(conditionType)) {
    throw new LegacyMappingError(`${where}.conditionType is unknown: ${conditionType}`);
  }
  const base = { id: uuidV5(`${ruleId}/${metadata}`), sensorId, enabled: true };
  const name = optionalText(raw.conditionName);
  const named = name === void 0 ? base : { ...base, name };
  if (raw.condition === "no-data") {
    const hours = optionalNumber(raw.duration, `${where}.duration`);
    if (hours === void 0 || hours <= 0) {
      throw new LegacyMappingError(`${where} is a no-data condition without a positive duration`);
    }
    return { ...named, operator: "no-data", noDataMinutes: hours * 60 };
  }
  if (typeof raw.condition !== "string" || !COMPARISON_OPERATORS2.has(raw.condition)) {
    throw new LegacyMappingError(`${where} has an unknown operator: ${String(raw.condition)}`);
  }
  const threshold = optionalNumber(raw.value, `${where}.value`);
  if (threshold === void 0) throw new LegacyMappingError(`${where} has no threshold value`);
  return {
    ...named,
    operator: raw.condition,
    threshold,
    sustain: mapSustain(raw, where)
  };
}
function mapController(raw) {
  const metadata = String(raw.metadata);
  const controllerId = optionalText(metadata.slice("controller-".length)) ?? optionalText(raw.controllerId);
  if (!controllerId) throw new LegacyMappingError(`controller ${metadata} has no controllerId`);
  const value = optionalNumber(raw.value, `controller ${metadata}.value`);
  if (value === void 0) throw new LegacyMappingError(`controller ${metadata} has no value`);
  const controller = { controllerId, value, enabled: raw.activate !== false };
  const name = optionalText(raw.controllerName);
  if (name !== void 0) controller.name = name;
  return controller;
}
function mapLineRecipient(value) {
  const idType = value.id_type ?? value.idType;
  const idName = value.id_name ?? value.idName;
  if (idType !== "user" && idType !== "group" || typeof idName !== "string" || idName === "") {
    throw new LegacyMappingError("notification has a LINE recipient object without a valid id_type / id_name");
  }
  return { id_type: idType, id_name: idName };
}
function mapNotify(raw) {
  const type = optionalText(raw.notificationType ?? raw.notification_type);
  const value = raw.notificationValue ?? raw.notification_detail;
  if (type === "line") {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return { type: "line", recipient: mapLineRecipient(value) };
    }
    return void 0;
  }
  if (type === "email" || type === "telegram") {
    const recipient = optionalText(value);
    return recipient === void 0 ? void 0 : { type, recipient };
  }
  return void 0;
}
function mapMeta(raw) {
  const meta = {};
  for (const field of ["createdAt", "updatedAt", "createdBy"]) {
    if (typeof raw[field] === "string") meta[field] = raw[field];
  }
  return meta;
}
function ruleObjectFromLegacyItems(ruleId, items) {
  try {
    let ownerId;
    let areaId;
    let name = "";
    let mode = "all";
    let cooldownMs = 0;
    let notify;
    let meta;
    const conditions = [];
    const ruleControllers = [];
    for (const raw of items) {
      const metadata = String(raw.metadata ?? "");
      if (metadata === "owner") {
        ownerId = optionalText(raw.ownerId);
        areaId = optionalText(raw.areaId);
      } else if (metadata === "name") {
        name = typeof raw.name === "string" ? raw.name : "";
      } else if (metadata === "ruleMode") {
        if (raw.value !== "any" && raw.value !== "all") throw new LegacyMappingError(`ruleMode is invalid: ${String(raw.value)}`);
        mode = raw.value;
      } else if (metadata === "minTriggerDuration") {
        const value = optionalNumber(raw.value, "minTriggerDuration.value");
        cooldownMs = value === void 0 || value < 0 ? 0 : value;
      } else if (metadata === "notification") {
        notify = mapNotify(raw);
      } else if (metadata === "meta") {
        meta = mapMeta(raw);
      } else if (metadata.startsWith("condition")) {
        conditions.push(mapCondition(ruleId, raw));
      } else if (metadata.startsWith("controller")) {
        ruleControllers.push(mapController(raw));
      }
    }
    if (!ownerId) {
      throw new LegacyMappingError("legacy rule has no owner item");
    }
    const rule = {
      id: ruleId,
      name,
      ownerId,
      enabled: true,
      cooldownMs,
      groupMode: "all",
      groups: conditions.length > 0 ? [{ id: uuidV5(`${ruleId}/group`), mode, conditions }] : [],
      ruleControllers
    };
    if (areaId !== void 0) rule.areaId = areaId;
    if (notify !== void 0) rule.notify = notify;
    if (meta !== void 0) rule.meta = meta;
    const validation = validateRuleObject(rule);
    if (!validation.ok) return { ok: false, errors: validation.errors.map((e) => `legacy rule ${ruleId}: ${e}`) };
    return { ok: true, data: rule };
  } catch (error) {
    if (error instanceof LegacyMappingError) return { ok: false, errors: [`legacy rule ${ruleId}: ${error.message}`] };
    throw error;
  }
}

// src/storage.ts
var DEFAULT_TABLE_NAME = "SensorRule";
var SCHEMA_VERSION = 2;
var DEFINITION_METADATA = "definition";
var SENSOR_INDEX_PREFIX = "sensor#";
var RULE_STATE_METADATA = /* @__PURE__ */ new Set(["lastTrigger", "state"]);
var MAX_TRANSACTION_ACTIONS = 100;
function normalizeAll(items) {
  return items.map((item, index) => {
    if (typeof item !== "object" || item === null) throw new Error(`items[${index}] must be an object`);
    return normalizeRawItem(item);
  });
}
function sameRuleId(items) {
  const ruleId = String(items[0]?.ruleId ?? "");
  if (!ruleId) throw new Error("Missing ruleId in input items");
  for (const item of items) {
    if (String(item.ruleId ?? "") !== ruleId) {
      throw new Error(`Mixed ruleId detected: ${String(item.ruleId)} vs ${ruleId}`);
    }
  }
  return ruleId;
}
function checkSchemaVersion(item) {
  const version = Number(item.schemaVersion);
  if (version > SCHEMA_VERSION) {
    throw new Error(`Rule ${String(item.ruleId)} uses schemaVersion ${version}; this SDK supports up to ${SCHEMA_VERSION}`);
  }
}
function isNewLayout(items) {
  return normalizeAll(items).some((item) => item.metadata === DEFINITION_METADATA);
}
function fromDdbItems(items) {
  try {
    if (!Array.isArray(items) || items.length === 0) return { ok: false, errors: ["Input items must be a non-empty array"] };
    const normalized = normalizeAll(items);
    const ruleId = sameRuleId(normalized);
    const definition = normalized.find((item) => item.metadata === DEFINITION_METADATA);
    if (!definition) return ruleObjectFromLegacyItems(ruleId, normalized);
    checkSchemaVersion(definition);
    const rule = definition.rule;
    if (typeof rule !== "object" || rule === null) return { ok: false, errors: [`Rule ${ruleId}: definition item has no rule`] };
    if (rule.id !== ruleId) return { ok: false, errors: [`Rule ${ruleId}: definition holds rule ${String(rule.id)}`] };
    const validation = validateRuleObject(rule);
    if (!validation.ok) return { ok: false, errors: validation.errors.map((e) => `Rule ${ruleId}: ${e}`) };
    return { ok: true, data: rule };
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }
}
function sensorIndexItems(rule) {
  const noDataSensors = /* @__PURE__ */ new Set();
  const sensors = /* @__PURE__ */ new Set();
  for (const group of rule.groups) {
    for (const condition of group.conditions) {
      sensors.add(condition.sensorId);
      if (condition.operator === "no-data") noDataSensors.add(condition.sensorId);
    }
  }
  return [...sensors].sort().map((sensorId) => {
    const item = {
      ruleId: rule.id,
      metadata: `${SENSOR_INDEX_PREFIX}${sensorId}`,
      schemaVersion: SCHEMA_VERSION,
      sensorId
    };
    if (noDataSensors.has(sensorId)) item.condition = "no-data";
    return item;
  });
}
function toWriteSet(ruleObject, previousItems = []) {
  try {
    const validation = validateRuleObject(ruleObject);
    if (!validation.ok) return { ok: false, errors: validation.errors };
    const rule = JSON.parse(JSON.stringify(ruleObject));
    const definition = {
      ruleId: rule.id,
      metadata: DEFINITION_METADATA,
      schemaVersion: SCHEMA_VERSION,
      ownerId: rule.ownerId,
      rule
    };
    const puts = [definition, ...sensorIndexItems(rule)];
    const putKeys = new Set(puts.map((item) => item.metadata));
    const deletes = [];
    const deleted = /* @__PURE__ */ new Set();
    for (const item of normalizeAll(previousItems)) {
      if (String(item.ruleId ?? "") !== rule.id) {
        return { ok: false, errors: [`previousItems contain an item of rule ${String(item.ruleId)}, not ${rule.id}`] };
      }
      if (item.metadata === DEFINITION_METADATA) checkSchemaVersion(item);
      const metadata = String(item.metadata ?? "");
      if (putKeys.has(metadata) || RULE_STATE_METADATA.has(metadata) || deleted.has(metadata)) continue;
      deleted.add(metadata);
      deletes.push({ ruleId: rule.id, metadata });
    }
    const actions = puts.length + deletes.length;
    if (actions > MAX_TRANSACTION_ACTIONS) {
      return { ok: false, errors: [`Writing rule ${rule.id} needs ${actions} actions; one transaction allows at most ${MAX_TRANSACTION_ACTIONS}`] };
    }
    return { ok: true, data: { puts, deletes } };
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }
}
function toTransactWriteItems(writeSet, tableName = DEFAULT_TABLE_NAME) {
  return [
    ...writeSet.puts.map((item) => ({ Put: { TableName: tableName, Item: { ...item } } })),
    ...writeSet.deletes.map((key) => ({ Delete: { TableName: tableName, Key: { ruleId: key.ruleId, metadata: key.metadata } } }))
  ];
}

// src/queries.ts
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var SENSOR_ID_INDEX = "sensorId-index";
var CONDITION_INDEX = "condition-index";
var OWNER_INDEX = "ownerId-ruleId-index";
function tableOf(options) {
  return options.tableName ?? DEFAULT_TABLE_NAME;
}
async function queryAll(client, input) {
  const items = [];
  let exclusiveStartKey;
  do {
    const page = await client.send(
      new import_lib_dynamodb.QueryCommand(exclusiveStartKey ? { ...input, ExclusiveStartKey: exclusiveStartKey } : input)
    );
    items.push(...page.Items ?? []);
    exclusiveStartKey = page.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return items;
}
async function queryRuleItems(client, ruleId, options) {
  return queryAll(client, {
    TableName: tableOf(options),
    KeyConditionExpression: "ruleId = :ruleId",
    ExpressionAttributeValues: { ":ruleId": ruleId },
    ConsistentRead: true
  });
}
function holdsDefinition(item) {
  const metadata = String(item.metadata ?? "");
  return !RULE_STATE_METADATA.has(metadata) && !metadata.startsWith(SENSOR_INDEX_PREFIX);
}
function distinctRuleIds(items) {
  return [...new Set(items.map((item) => String(item.ruleId ?? "")).filter((id) => id !== ""))];
}
async function loadRules(client, ruleIds, options) {
  const lookup = { rules: [], errors: [] };
  const results = await Promise.all(ruleIds.map((ruleId) => getRule(client, ruleId, options)));
  results.forEach((result, index) => {
    const ruleId = ruleIds[index];
    if (!result.ok) lookup.errors.push({ ruleId, errors: result.errors });
    else if (result.data) lookup.rules.push(result.data);
  });
  return lookup;
}
async function getRule(client, ruleId, options = {}) {
  const items = await queryRuleItems(client, ruleId, options);
  if (!items.some(holdsDefinition)) return { ok: true, data: null };
  return fromDdbItems(items);
}
async function findRulesBySensorId(client, sensorId, options = {}) {
  const indexed = await queryAll(client, {
    TableName: tableOf(options),
    IndexName: SENSOR_ID_INDEX,
    KeyConditionExpression: "sensorId = :sensorId",
    ExpressionAttributeValues: { ":sensorId": sensorId }
  });
  const lookup = await loadRules(client, distinctRuleIds(indexed), options);
  lookup.rules = lookup.rules.filter(
    (rule) => rule.groups.some((group) => group.conditions.some((condition) => condition.sensorId === sensorId))
  );
  return lookup;
}
async function findNoDataConditions(client, options = {}) {
  const indexed = await queryAll(client, {
    TableName: tableOf(options),
    IndexName: CONDITION_INDEX,
    KeyConditionExpression: "#condition = :condition",
    ExpressionAttributeNames: { "#condition": "condition" },
    ExpressionAttributeValues: { ":condition": "no-data" }
  });
  const { rules, errors } = await loadRules(client, distinctRuleIds(indexed), options);
  const conditions = [];
  for (const rule of rules) {
    for (const group of rule.groups) {
      for (const condition of group.conditions) {
        if (condition.operator === "no-data") conditions.push({ rule, condition });
      }
    }
  }
  return { conditions, errors };
}
async function listRulesByOwner(client, ownerId, options = {}) {
  const indexed = await queryAll(client, {
    TableName: tableOf(options),
    IndexName: OWNER_INDEX,
    KeyConditionExpression: "ownerId = :ownerId",
    ExpressionAttributeValues: { ":ownerId": ownerId }
  });
  const lookup = { rules: [], errors: [] };
  const legacyIds = [];
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
async function putRule(client, ruleObject, options = {}) {
  const previous = await queryRuleItems(client, ruleObject.id, options);
  const writeSet = toWriteSet(ruleObject, previous);
  if (!writeSet.ok) return { ok: false, errors: writeSet.errors };
  await client.send(new import_lib_dynamodb.TransactWriteCommand({ TransactItems: toTransactWriteItems(writeSet.data, tableOf(options)) }));
  return { ok: true, errors: [] };
}
async function deleteRule(client, ruleId, options = {}) {
  const items = await queryRuleItems(client, ruleId, options);
  const tableName = tableOf(options);
  for (let start = 0; start < items.length; start += MAX_TRANSACTION_ACTIONS) {
    const chunk = items.slice(start, start + MAX_TRANSACTION_ACTIONS);
    await client.send(
      new import_lib_dynamodb.TransactWriteCommand({
        TransactItems: chunk.map((item) => ({
          Delete: { TableName: tableName, Key: { ruleId, metadata: String(item.metadata) } }
        }))
      })
    );
  }
  return { deleted: items.length };
}

// src/rule-state.ts
var import_lib_dynamodb2 = require("@aws-sdk/lib-dynamodb");
var RULE_STATE_METADATA_KEY = "state";
function optionalIso(value) {
  return typeof value === "string" && value !== "" ? value : null;
}
async function getRuleState(client, ruleId, options = {}) {
  const TableName = options.tableName ?? DEFAULT_TABLE_NAME;
  const state = await client.send(new import_lib_dynamodb2.GetCommand({ TableName, Key: { ruleId, metadata: RULE_STATE_METADATA_KEY }, ConsistentRead: true }));
  if (state.Item) {
    return {
      lastTriggeredAt: optionalIso(state.Item.lastTriggeredAt),
      triggered: state.Item.triggered === true,
      recoveredAt: optionalIso(state.Item.recoveredAt),
      version: Number(state.Item.version) || 0
    };
  }
  const legacy = await client.send(new import_lib_dynamodb2.GetCommand({ TableName, Key: { ruleId, metadata: "lastTrigger" }, ConsistentRead: true }));
  return { lastTriggeredAt: optionalIso(legacy.Item?.value), triggered: false, recoveredAt: null, version: 0 };
}
function stateErrors(state) {
  const errors = [];
  for (const field of ["lastTriggeredAt", "recoveredAt"]) {
    const value = state[field];
    if (value !== null && (typeof value !== "string" || Number.isNaN(Date.parse(value)))) {
      errors.push(`RuleState.${field} must be an ISO 8601 time or null`);
    }
  }
  if (typeof state.triggered !== "boolean") errors.push("RuleState.triggered must be a boolean");
  if (!Number.isInteger(state.version) || state.version < 0) errors.push("RuleState.version must be an integer >= 0");
  return errors;
}
async function putRuleState(client, ruleId, state, options = {}) {
  const errors = stateErrors(state);
  if (errors.length > 0) return { ok: false, conflict: false, errors };
  const version = state.version + 1;
  const Item = {
    ruleId,
    metadata: RULE_STATE_METADATA_KEY,
    schemaVersion: SCHEMA_VERSION,
    version,
    triggered: state.triggered
  };
  if (state.lastTriggeredAt !== null) Item.lastTriggeredAt = state.lastTriggeredAt;
  if (state.recoveredAt !== null) Item.recoveredAt = state.recoveredAt;
  const condition = state.version === 0 ? { ConditionExpression: "attribute_not_exists(ruleId)" } : {
    ConditionExpression: "#version = :expected",
    ExpressionAttributeNames: { "#version": "version" },
    ExpressionAttributeValues: { ":expected": state.version }
  };
  try {
    await client.send(new import_lib_dynamodb2.PutCommand({ TableName: options.tableName ?? DEFAULT_TABLE_NAME, Item, ...condition }));
    return { ok: true, version };
  } catch (error) {
    if (error.name === "ConditionalCheckFailedException") {
      return { ok: false, conflict: true, errors: [`Rule State of ${ruleId} changed after version ${state.version} was read`] };
    }
    throw error;
  }
}

// src/rule-change.ts
var RULE_CHANGE_TOPIC = "notifyEngine/ruleChange";
var RULE_CHANGE_SCHEMA_VERSION = 2;
var CHANGE_TYPES = /* @__PURE__ */ new Set(["created", "updated", "deleted"]);
var LEGACY_MESSAGES = {
  "add-rule": "created",
  "delete-rule": "deleted",
  "update-condition": "updated",
  "delete-condition": "updated",
  "update-notification": "updated",
  "delete-notification": "updated",
  "delete-controller": "updated",
  "Rule created": "created",
  "Rule updated": "updated",
  "Rule deleted": "deleted",
  "Condition updated": "updated",
  "Condition deleted": "updated",
  "Controller updated": "updated",
  "Controller deleted": "updated"
};
var LEGACY_TYPES = { add: "created", update: "updated", delete: "updated" };
function encodeRuleChange(change) {
  if (!CHANGE_TYPES.has(change.type)) throw new Error(`Unknown rule change type: ${String(change.type)}`);
  if (typeof change.ruleId !== "string" || change.ruleId === "") throw new Error("RuleChange.ruleId is required");
  return JSON.stringify({ schemaVersion: RULE_CHANGE_SCHEMA_VERSION, type: change.type, ruleId: change.ruleId });
}
function parsePayload(payload) {
  let value = payload;
  if (value instanceof Uint8Array) value = new TextDecoder().decode(value);
  if (typeof value === "string") value = JSON.parse(value);
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("ruleChange payload must be a JSON object");
  return value;
}
function decodeRuleChange(payload) {
  let message;
  try {
    message = parsePayload(payload);
  } catch (error) {
    return { ok: false, errors: [`Cannot parse ruleChange payload: ${error.message}`] };
  }
  const ruleId = message.ruleId;
  if (typeof ruleId !== "string" || ruleId === "") return { ok: false, errors: ["ruleChange payload has no ruleId"] };
  if (message.schemaVersion !== void 0) {
    if (message.schemaVersion !== RULE_CHANGE_SCHEMA_VERSION) {
      return { ok: false, errors: [`ruleChange schemaVersion ${String(message.schemaVersion)} is not supported`] };
    }
    if (typeof message.type !== "string" || !CHANGE_TYPES.has(message.type)) {
      return { ok: false, errors: [`Unknown rule change type: ${String(message.type)}`] };
    }
    return { ok: true, data: { type: message.type, ruleId, format: "v2" } };
  }
  const legacyMessage = typeof message.msg === "string" ? message.msg : void 0;
  const type = (legacyMessage !== void 0 ? LEGACY_MESSAGES[legacyMessage] : void 0) ?? (typeof message.type === "string" ? LEGACY_TYPES[message.type] : void 0);
  if (!type) {
    return { ok: false, errors: [`Unknown legacy ruleChange message: type ${String(message.type)}, msg ${String(message.msg)}`] };
  }
  const decoded = { type, ruleId, format: "legacy" };
  if (legacyMessage !== void 0) decoded.legacyMessage = legacyMessage;
  return { ok: true, data: decoded };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEFAULT_TABLE_NAME,
  MAX_TRANSACTION_ACTIONS,
  RULE_CHANGE_SCHEMA_VERSION,
  RULE_CHANGE_TOPIC,
  RULE_STATE_METADATA_KEY,
  decodeRuleChange,
  deleteRule,
  encodeRuleChange,
  findNoDataConditions,
  findRulesBySensorId,
  fromDdbItems,
  fromLegacyDdbItems,
  getRule,
  getRuleState,
  isNewLayout,
  listRulesByOwner,
  normalizeCondition,
  normalizeController,
  normalizeLegacyRuleObject,
  normalizeMeta,
  normalizeNotify,
  normalizeRawItem,
  putRule,
  putRuleState,
  toLegacyDdbItems,
  toTransactWriteItems,
  toWriteSet,
  validateLegacyRuleObject,
  validateRuleObject
});
