import type { ConditionOperator } from "./types";

/*
 * Sensor Rule v2 domain object (IoT-Platform-API ADR-0011).
 *
 * `RuleObject` is the single contract shared by the API, the rule engine and the
 * no-data service. It holds user settings only: runtime state such as the last
 * trigger time belongs to the Rule State, which is stored separately.
 * Terms follow the "控制" section of IoT-Platform-API's CONTEXT.md.
 */

/** How conditions (inside a group) or groups (inside a rule) are combined. */
export type GroupMode = "any" | "all";

/** Operators that compare a reading against a threshold. */
export type ComparisonOperator = Exclude<ConditionOperator, "no-data">;

/**
 * How long a comparison must keep holding before the condition counts as met.
 * - `count`: the latest `n` readings all satisfy the comparison.
 * - `ratio`: within the last `windowMinutes`, at least `percent`% of readings satisfy it.
 * - `continuous`: the comparison has held for `minutes`, judged on received readings only
 *   (a gap in readings is not a failure; that is what no-data conditions are for).
 */
export type Sustain =
  | { type: "count"; n: number }
  | { type: "ratio"; windowMinutes: number; percent: number }
  | { type: "continuous"; minutes: number };

export interface ConditionBase {
  /** UUID of the condition, unique within the rule. */
  id: string;
  /** Sensor whose readings are judged. */
  sensorId: string;
  /** A disabled condition is treated as absent. */
  enabled: boolean;
  /** Optional display name. */
  name?: string;
}

/** Compares the readings of a sensor against a threshold. */
export interface ComparisonCondition extends ConditionBase {
  operator: ComparisonOperator;
  /** Trigger threshold; decimals are kept. */
  threshold: number;
  /**
   * Recovery Threshold: once met, the condition stops holding only after readings
   * cross this value. Defaults to `threshold` when absent.
   */
  recoveryThreshold?: number;
  sustain: Sustain;
}

/** Holds when the sensor has sent no readings for `noDataMinutes`. */
export interface NoDataCondition extends ConditionBase {
  operator: "no-data";
  noDataMinutes: number;
}

export type Condition = ComparisonCondition | NoDataCondition;

/** A non-empty set of conditions combined by `mode`. Groups do not nest. */
export interface ConditionGroup {
  /** Identifier of the group, unique within the rule. */
  id: string;
  mode: GroupMode;
  conditions: Condition[];
}

/** LINE recipient as bound in `Notification.line_list` (IoT-Platform-API #58). */
export interface LineRecipient {
  id_type: "user" | "group";
  id_name: string;
}

/** One notification channel per rule. */
export type Notify =
  | { type: "line"; recipient: LineRecipient }
  | { type: "email"; recipient: string }
  | { type: "telegram"; recipient: string };

/** A Controller operated when the rule triggers, with its target value. */
export interface RuleController {
  controllerId: string;
  /** Display name of the controller. */
  name?: string;
  /** Target value; the engine uses it as the work cycle. */
  value: number;
  enabled: boolean;
}

export interface RuleMeta {
  /** ISO 8601 creation time. */
  createdAt?: string;
  /** ISO 8601 time of the latest update. */
  updatedAt?: string;
  /** Account ID of the creator. */
  createdBy?: string;
}

export interface RuleObject {
  /** Rule ID. */
  id: string;
  /** Display name. */
  name: string;
  /** Account ID of the owner. */
  ownerId: string;
  /** Area the rule belongs to; rules created before Areas were recorded may lack it. */
  areaId?: string;
  /** A disabled rule is not judged. */
  enabled: boolean;
  /** Cooldown: minimum interval between two triggers, in milliseconds. */
  cooldownMs: number;
  /** How the condition groups are combined. */
  groupMode: GroupMode;
  /** Condition groups; a rule with no groups never triggers. */
  groups: ConditionGroup[];
  ruleControllers: RuleController[];
  notify?: Notify;
  meta?: RuleMeta;
}
