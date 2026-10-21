import type { Condition, LineRecipient, Notify, RuleController, RuleMeta, RuleObject, Sustain } from "./rule-object";
import type { TransformResult } from "./types";
import { uuidV5 } from "./uuid";
import { validateRuleObject } from "./validate";

/*
 * Reads a rule stored in the legacy layout (one item per owner, name, ruleMode,
 * condition-*, controller-*, notification, ...) as a v2 RuleObject.
 * Every case of missing or unusual legacy data is handled explicitly below and
 * listed in the README ("Reading legacy rules").
 */

const COMPARISON_OPERATORS = new Set([">", "<", "=", ">=", "<=", "!="]);
const KNOWN_CONDITION_TYPES = new Set(["Continual", "Duration", "-1"]);

class LegacyMappingError extends Error {}

/** Treats undefined, null and "" as absent; parses numeric strings. */
function optionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) throw new LegacyMappingError(`${field} is not a number: ${String(value)}`);
  return n;
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function mapSustain(raw: Record<string, unknown>, where: string): Sustain {
  const unit = optionalText(raw.conditionUnit);
  const limit = optionalNumber(raw.conditionLimit, `${where}.conditionLimit`);

  if (unit === "Percent") {
    const hours = optionalNumber(raw.duration, `${where}.duration`);
    if (hours === undefined || hours <= 0) {
      throw new LegacyMappingError(`${where} is a Percent condition without a positive duration`);
    }
    if (limit === undefined || limit <= 0 || limit > 100) {
      throw new LegacyMappingError(`${where}.conditionLimit must be greater than 0 and at most 100 for a Percent condition`);
    }
    return { type: "ratio", windowMinutes: hours * 60, percent: limit };
  }
  if (unit === undefined || unit === "Times") {
    // `Times` means the latest N readings; a missing unit (written by /api/v2/sensor-rule) is read the same way.
    // A legacy `Duration` + `Times` window cannot be expressed in v2, so its duration is dropped.
    const n = limit ?? 1;
    if (!Number.isInteger(n) || n < 1) {
      throw new LegacyMappingError(`${where}.conditionLimit must be a positive integer for a Times condition`);
    }
    return { type: "count", n };
  }
  throw new LegacyMappingError(`${where}.conditionUnit is unknown: ${unit}`);
}

function mapCondition(ruleId: string, raw: Record<string, unknown>): Condition {
  const metadata = String(raw.metadata);
  const where = `condition ${metadata}`;
  const sensorId = optionalText(raw.sensorId);
  if (!sensorId) throw new LegacyMappingError(`${where} has no sensorId`);
  const conditionType = optionalText(raw.conditionType);
  if (conditionType !== undefined && !KNOWN_CONDITION_TYPES.has(conditionType)) {
    throw new LegacyMappingError(`${where}.conditionType is unknown: ${conditionType}`);
  }

  const base = { id: uuidV5(`${ruleId}/${metadata}`), sensorId, enabled: true };
  const name = optionalText(raw.conditionName);
  const named = name === undefined ? base : { ...base, name };

  if (raw.condition === "no-data") {
    const hours = optionalNumber(raw.duration, `${where}.duration`);
    if (hours === undefined || hours <= 0) {
      throw new LegacyMappingError(`${where} is a no-data condition without a positive duration`);
    }
    return { ...named, operator: "no-data", noDataMinutes: hours * 60 };
  }
  if (typeof raw.condition !== "string" || !COMPARISON_OPERATORS.has(raw.condition)) {
    throw new LegacyMappingError(`${where} has an unknown operator: ${String(raw.condition)}`);
  }
  const threshold = optionalNumber(raw.value, `${where}.value`);
  if (threshold === undefined) throw new LegacyMappingError(`${where} has no threshold value`);
  return {
    ...named,
    operator: raw.condition as Exclude<Condition["operator"], "no-data">,
    threshold,
    sustain: mapSustain(raw, where)
  };
}

function mapController(raw: Record<string, unknown>): RuleController {
  const metadata = String(raw.metadata);
  const controllerId = optionalText(metadata.slice("controller-".length)) ?? optionalText(raw.controllerId);
  if (!controllerId) throw new LegacyMappingError(`controller ${metadata} has no controllerId`);
  const value = optionalNumber(raw.value, `controller ${metadata}.value`);
  if (value === undefined) throw new LegacyMappingError(`controller ${metadata} has no value`);
  const controller: RuleController = { controllerId, value, enabled: raw.activate !== false };
  const name = optionalText(raw.controllerName);
  if (name !== undefined) controller.name = name;
  return controller;
}

function mapLineRecipient(value: Record<string, unknown>): LineRecipient {
  const idType = value.id_type ?? value.idType;
  const idName = value.id_name ?? value.idName;
  if ((idType !== "user" && idType !== "group") || typeof idName !== "string" || idName === "") {
    throw new LegacyMappingError("notification has a LINE recipient object without a valid id_type / id_name");
  }
  return { id_type: idType, id_name: idName };
}

/** Returns undefined when the legacy notification cannot be delivered any more or has no recipient. */
function mapNotify(raw: Record<string, unknown>): Notify | undefined {
  const type = optionalText(raw.notificationType ?? raw.notification_type);
  const value = raw.notificationValue ?? raw.notification_detail;
  if (type === "line") {
    // A string value is a LINE Notify token; LINE Notify has shut down, so nothing can be delivered.
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return { type: "line", recipient: mapLineRecipient(value as Record<string, unknown>) };
    }
    return undefined;
  }
  if (type === "email" || type === "telegram") {
    const recipient = optionalText(value);
    return recipient === undefined ? undefined : { type, recipient };
  }
  // Missing or unknown channel: the rule is still judged, it just notifies no one.
  return undefined;
}

function mapMeta(raw: Record<string, unknown>): RuleMeta {
  const meta: RuleMeta = {};
  for (const field of ["createdAt", "updatedAt", "createdBy"] as const) {
    if (typeof raw[field] === "string") meta[field] = raw[field] as string;
  }
  return meta;
}

/**
 * `items` must already be normalized (plain values, one ruleId).
 * Items that carry no definition (lastTrigger, state, unknown metadata) are skipped.
 */
export function ruleObjectFromLegacyItems(ruleId: string, items: Record<string, unknown>[]): TransformResult<RuleObject> {
  try {
    let ownerId: string | undefined;
    let areaId: string | undefined;
    let name = "";
    let mode: "any" | "all" = "all";
    let cooldownMs = 0;
    let notify: Notify | undefined;
    let meta: RuleMeta | undefined;
    const conditions: Condition[] = [];
    const ruleControllers: RuleController[] = [];

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
        // The legacy reader used -1 for "not set"; any negative or missing value means no cooldown.
        cooldownMs = value === undefined || value < 0 ? 0 : value;
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
      // Every legacy write path stores an owner item; items without one are leftovers of a broken write.
      throw new LegacyMappingError("legacy rule has no owner item");
    }

    const rule: RuleObject = {
      id: ruleId,
      name,
      ownerId,
      enabled: true,
      cooldownMs,
      groupMode: "all",
      groups: conditions.length > 0 ? [{ id: uuidV5(`${ruleId}/group`), mode, conditions }] : [],
      ruleControllers
    };
    if (areaId !== undefined) rule.areaId = areaId;
    if (notify !== undefined) rule.notify = notify;
    if (meta !== undefined) rule.meta = meta;

    const validation = validateRuleObject(rule);
    if (!validation.ok) return { ok: false, errors: validation.errors.map((e) => `legacy rule ${ruleId}: ${e}`) };
    return { ok: true, data: rule };
  } catch (error) {
    if (error instanceof LegacyMappingError) return { ok: false, errors: [`legacy rule ${ruleId}: ${error.message}`] };
    throw error;
  }
}
