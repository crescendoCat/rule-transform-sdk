export type RuleMetadata =
  | "notification"
  | "name"
  | "lastTrigger"
  | "minTriggerDuration"
  | "owner"
  | "ruleMode"
  | string;

export interface RuleItemBase {
  ruleId: string;
  metadata: RuleMetadata;
}

export type ConditionOperator = ">" | "<" | "=" | ">=" | "<=" | "!=" | "no-data";
export type ConditionType = "Continual" | "Duration" | "-1";
export type ConditionUnit = "Percent" | "Times";

export interface RuleConditionItem extends RuleItemBase {
  metadata: string;
  sensorId: string;
  condition: ConditionOperator;
  value?: number;
  conditionType?: ConditionType;
  duration?: number;
  conditionUnit?: ConditionUnit;
  conditionLimit?: number;
}

export interface RuleNotificationValueLine {
  idType?: string;
  idName?: string;
  id_type?: string;
  id_name?: string;
}

export interface RuleNotificationItem extends RuleItemBase {
  metadata: "notification";
  notificationType?: string;
  notificationValue?: string | RuleNotificationValueLine;
  notification_type?: string;
  notification_detail?: string | RuleNotificationValueLine;
}

export interface RuleNameItem extends RuleItemBase {
  metadata: "name";
  name: string;
}

export interface RuleLastTriggerItem extends RuleItemBase {
  metadata: "lastTrigger";
  value: string;
}

export interface RuleMinTriggerDurationItem extends RuleItemBase {
  metadata: "minTriggerDuration";
  value: number;
}

export interface RuleOwnerItem extends RuleItemBase {
  metadata: "owner";
  ownerId: string;
  areaId?: string;
}

export interface RuleModeItem extends RuleItemBase {
  metadata: "ruleMode";
  value: "or" | "and";
}

export interface RuleControllerItem extends RuleItemBase {
  metadata: string;
  controllerId?: string;
  controllerName?: string;
  value: number;
  activate?: boolean;
}

export type RuleItem =
  | RuleConditionItem
  | RuleNotificationItem
  | RuleNameItem
  | RuleLastTriggerItem
  | RuleMinTriggerDurationItem
  | RuleOwnerItem
  | RuleModeItem
  | RuleControllerItem;

export interface RuleNotify {
  notificationType: string;
  notificationValue: string | RuleNotificationValueLine;
}

export interface RuleObject {
  Id: string;
  minTriggerDuration: number;
  lastTriggerValue: Date | null;
  name: string;
  conditions: RuleConditionItem[];
  notify?: RuleNotify;
  controllers: Record<string, number>;
  ruleMode: "or" | "and";
  owner: string | null;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export type TransformResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: string[] };
