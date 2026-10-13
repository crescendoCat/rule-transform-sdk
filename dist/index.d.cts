type RuleMetadata = "notification" | "name" | "lastTrigger" | "minTriggerDuration" | "owner" | "ruleMode" | "meta" | string;
/**
 * Base shape shared by all rule items stored in the same rule set.
 */
interface RuleItemBase {
    /** Unique identifier of the parent rule. */
    ruleId: string;
    /**
     * Item category or sort key value.
     * Known values include metadata types like "notification" and "ruleMode",
     * while condition/controller records usually use dynamic keys.
     */
    metadata: RuleMetadata;
}
type ConditionOperator = ">" | "<" | "=" | ">=" | "<=" | "!=" | "no-data";
type ConditionType = "Continual" | "Duration" | "-1";
type ConditionUnit = "Percent" | "Times";
interface RuleConditionItem extends RuleItemBase {
    /**
     * Indicates this item is a condition and is commonly used as a DynamoDB sort key.
     * Example: "condition-00000000-0000-0000-0000-000000000000"
     */
    metadata: string;
    /** UUID-like sensor identifier associated with this condition. */
    sensorId: string;
    /** Comparison operator used by this condition. */
    condition: ConditionOperator;
    /** Threshold value for comparison. Optional for "no-data". */
    value?: number;
    /**
     * Condition evaluation mode:
     * - "Continual": compare against latest samples continuously.
     * - "Duration": evaluate within a duration window.
     * - "-1": reserved for "no-data" conditions.
     */
    conditionType?: ConditionType;
    /** Duration window in hours for condition evaluation. */
    duration?: number;
    /** Unit for duration-based limit, such as Percent or Times. */
    conditionUnit?: ConditionUnit;
    /** Threshold used with duration-based conditions. */
    conditionLimit?: number;
}
interface RuleMetaItem extends RuleItemBase {
    metadata: "meta";
    /** ISO8601 timestring of when the rule was created. */
    createdAt?: string;
    /** ISO8601 timestring of when the rule was last updated. */
    updatedAt?: string;
    /** Optional userId(uuidv4) of the user that created this rule.  */
    createdBy?: string;
}
/**
 * Value payload for Line notification targets.
 * Both camelCase and snake_case keys are supported for compatibility.
 */
interface RuleNotificationValueLine {
    idType?: string;
    idName?: string;
    id_type?: string;
    id_name?: string;
}
interface RuleNotificationItem extends RuleItemBase {
    /** Fixed metadata value for notification records. */
    metadata: "notification";
    /**
     * Notification channel.
     * Common values: "email", "telegram", "line".
     */
    notificationType?: string;
    /**
     * Notification target payload.
     * - string: email/chat id/user id
     * - object: structured Line id payload
     */
    notificationValue?: string | RuleNotificationValueLine;
    /** Legacy snake_case alias of notificationType. */
    notification_type?: string;
    /** Legacy snake_case alias of notificationValue. */
    notification_detail?: string | RuleNotificationValueLine;
}
interface RuleNameItem extends RuleItemBase {
    metadata: "name";
    /** Display name of the rule. */
    name: string;
}
interface RuleLastTriggerItem extends RuleItemBase {
    metadata: "lastTrigger";
    /** ISO timestamp string of the last trigger event. */
    value: string;
}
interface RuleMinTriggerDurationItem extends RuleItemBase {
    metadata: "minTriggerDuration";
    /** Minimum interval between triggers. */
    value: number;
}
interface RuleOwnerItem extends RuleItemBase {
    metadata: "owner";
    /** Owner identifier of this rule. */
    ownerId: string;
    /** Optional area identifier under the owner scope. */
    areaId?: string;
}
interface RuleModeItem extends RuleItemBase {
    /** Fixed metadata value for rule mode records. */
    metadata: "ruleMode";
    /**
     * Rule evaluation mode.
     * - "any": trigger when any condition matches.
     * - "all": trigger only when all conditions match.
     */
    value: "any" | "all";
}
interface RuleControllerItem extends RuleItemBase {
    /**
     * Indicates this item is a controller setting and is commonly used as a sort key.
     * Example: "controller-00000000-0000-0000-0000-000000000000"
     */
    metadata: string;
    /** UUID-like controller identifier. */
    controllerId?: string;
    /** Human-readable controller name, e.g., pump or fan. */
    controllerName?: string;
    /** Controller output value (often duration or intensity). */
    value: number;
    /** Whether the controller should be activated on trigger. */
    activate?: boolean;
}
type RuleItem = RuleConditionItem | RuleNotificationItem | RuleNameItem | RuleLastTriggerItem | RuleMinTriggerDurationItem | RuleOwnerItem | RuleModeItem | RuleMetaItem | RuleControllerItem;
interface RuleNotify {
    /** Notification channel, e.g., email/telegram/line. */
    notificationType: string;
    /** Notification target payload. */
    notificationValue: string | RuleNotificationValueLine;
}
interface RuleObject {
    /** Unique identifier for the rule. */
    Id: string;
    /** Minimum duration required between two trigger events. */
    minTriggerDuration: number;
    /** Timestamp of the latest trigger; null when never triggered. */
    lastTriggerValue: Date | null;
    /** Rule display name. */
    name: string;
    /** All conditions evaluated by this rule. */
    conditions: RuleConditionItem[];
    /** Notification configuration for this rule. */
    notify?: RuleNotify;
    /** All controllers associated with this rule. */
    controllers: RuleControllerItem[];
    /** Condition aggregation mode. */
    ruleMode: "any" | "all";
    /** Owner id if assigned; otherwise null. */
    owner: string | null;
    /** Optional metadata about the rule. */
    meta?: RuleMetaItem;
}
interface ValidationResult {
    ok: boolean;
    errors: string[];
}
type TransformResult<T> = {
    ok: true;
    data: T;
} | {
    ok: false;
    errors: string[];
};

declare function normalizeRawItem(item: Record<string, unknown>): Record<string, unknown>;
declare function normalizeNotify(item: Record<string, unknown>): RuleNotify;
declare function normalizeCondition(raw: Record<string, unknown>): RuleConditionItem;
declare function normalizeMeta(raw: Record<string, unknown>): RuleMetaItem;
declare function normalizeController(raw: Record<string, unknown>): RuleControllerItem;
declare function fromDdbItems(items: RuleItem[]): TransformResult<RuleObject>;
declare function toDdbItems(ruleObject: RuleObject): TransformResult<RuleItem[]>;
declare function validateRuleObject(ruleObject: unknown): ValidationResult;
declare function normalizeRuleObject(ruleObject: RuleObject): RuleObject;

export { type ConditionOperator, type ConditionType, type ConditionUnit, type RuleConditionItem, type RuleControllerItem, type RuleItem, type RuleItemBase, type RuleLastTriggerItem, type RuleMetaItem, type RuleMetadata, type RuleMinTriggerDurationItem, type RuleModeItem, type RuleNameItem, type RuleNotificationItem, type RuleNotificationValueLine, type RuleNotify, type RuleObject, type RuleOwnerItem, type TransformResult, type ValidationResult, fromDdbItems, normalizeCondition, normalizeController, normalizeMeta, normalizeNotify, normalizeRawItem, normalizeRuleObject, toDdbItems, validateRuleObject };
