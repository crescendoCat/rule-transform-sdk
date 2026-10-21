import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

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
/**
 * Notification of the legacy (0.3.x) rule object.
 * @deprecated Use `Notify` of the v2 `RuleObject`.
 */
interface LegacyRuleNotify {
    /** Notification channel, e.g., email/telegram/line. */
    notificationType: string;
    /** Notification target payload. */
    notificationValue: string | RuleNotificationValueLine;
}
/**
 * The 0.3.x rule object, a thin wrapper around the legacy item layout.
 * Kept so that consumers still reading the legacy layout through
 * `fromLegacyDdbItems` keep working; new code uses the v2 `RuleObject`.
 * @deprecated Use the v2 `RuleObject`.
 */
interface LegacyRuleObject {
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
    notify?: LegacyRuleNotify;
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

/**
 * Validates a v2 `RuleObject`. Returns every problem found, with a path to the field.
 * Values are only checked, never converted (thresholds keep their decimals).
 */
declare function validateRuleObject(ruleObject: unknown): ValidationResult;

/** How conditions (inside a group) or groups (inside a rule) are combined. */
type GroupMode = "any" | "all";
/** Operators that compare a reading against a threshold. */
type ComparisonOperator = Exclude<ConditionOperator, "no-data">;
/**
 * How long a comparison must keep holding before the condition counts as met.
 * - `count`: the latest `n` readings all satisfy the comparison.
 * - `ratio`: within the last `windowMinutes`, at least `percent`% of readings satisfy it.
 * - `continuous`: the comparison has held for `minutes`, judged on received readings only
 *   (a gap in readings is not a failure; that is what no-data conditions are for).
 */
type Sustain = {
    type: "count";
    n: number;
} | {
    type: "ratio";
    windowMinutes: number;
    percent: number;
} | {
    type: "continuous";
    minutes: number;
};
interface ConditionBase {
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
interface ComparisonCondition extends ConditionBase {
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
interface NoDataCondition extends ConditionBase {
    operator: "no-data";
    noDataMinutes: number;
}
type Condition = ComparisonCondition | NoDataCondition;
/** A non-empty set of conditions combined by `mode`. Groups do not nest. */
interface ConditionGroup {
    /** Identifier of the group, unique within the rule. */
    id: string;
    mode: GroupMode;
    conditions: Condition[];
}
/** LINE recipient as bound in `Notification.line_list` (IoT-Platform-API #58). */
interface LineRecipient {
    id_type: "user" | "group";
    id_name: string;
}
/** One notification channel per rule. */
type Notify = {
    type: "line";
    recipient: LineRecipient;
} | {
    type: "email";
    recipient: string;
} | {
    type: "telegram";
    recipient: string;
};
/** A Controller operated when the rule triggers, with its target value. */
interface RuleController {
    controllerId: string;
    /** Display name of the controller. */
    name?: string;
    /** Target value; the engine uses it as the work cycle. */
    value: number;
    enabled: boolean;
}
interface RuleMeta {
    /** ISO 8601 creation time. */
    createdAt?: string;
    /** ISO 8601 time of the latest update. */
    updatedAt?: string;
    /** Account ID of the creator. */
    createdBy?: string;
}
interface RuleObject {
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

declare const DEFAULT_TABLE_NAME = "SensorRule";
declare const DEFINITION_METADATA = "definition";
/** TransactWriteItems accepts at most this many actions. */
declare const MAX_TRANSACTION_ACTIONS = 100;
interface RuleItemKey {
    ruleId: string;
    metadata: string;
}
interface RuleDefinitionItem extends RuleItemKey {
    metadata: typeof DEFINITION_METADATA;
    schemaVersion: number;
    ownerId: string;
    rule: RuleObject;
}
interface RuleSensorIndexItem extends RuleItemKey {
    schemaVersion: number;
    sensorId: string;
    condition?: "no-data";
}
/** Items to put and keys to delete, written together in one transaction. */
interface WriteSet {
    puts: (RuleDefinitionItem | RuleSensorIndexItem)[];
    deletes: RuleItemKey[];
}
/** Input of DynamoDB DocumentClient's TransactWriteCommand (`TransactItems`). */
type DocumentTransactWriteItem = {
    Put: {
        TableName: string;
        Item: Record<string, unknown>;
    };
} | {
    Delete: {
        TableName: string;
        Key: RuleItemKey;
    };
};
/**
 * True when the items of a rule are in the v2 layout. The legacy API (v1) uses it to
 * leave v2 rules alone. Accepts DocumentClient items and raw AttributeValue items.
 */
declare function isNewLayout(items: readonly unknown[]): boolean;
/**
 * Reads every item of one rule (in either layout) as a RuleObject.
 * Index items and Rule State items are ignored. When a definition item exists it is
 * authoritative and any leftover legacy items are ignored.
 */
declare function fromDdbItems(items: readonly unknown[]): TransformResult<RuleObject>;
/**
 * Builds the items to put and delete so that, after one transaction, the rule is stored
 * in the v2 layout and nothing stale is left.
 *
 * `previousItems` are the items currently stored for the rule (all of them, as returned by
 * a query on ruleId; either layout). Everything previously stored that the new write does not
 * put is deleted: legacy items when converting a legacy rule, and index items of sensors the
 * rule no longer references. Rule State items are kept.
 */
declare function toWriteSet(ruleObject: RuleObject, previousItems?: readonly unknown[]): TransformResult<WriteSet>;
/** Turns a write set into `TransactItems` for DynamoDB DocumentClient's TransactWriteCommand. */
declare function toTransactWriteItems(writeSet: WriteSet, tableName?: string): DocumentTransactWriteItem[];

interface TableOptions {
    /** Defaults to "SensorRule". */
    tableName?: string;
}
/** Rules found by a query, plus the rules that could not be read and why. */
interface RuleLookup {
    rules: RuleObject[];
    errors: {
        ruleId: string;
        errors: string[];
    }[];
}
interface NoDataConditionRef {
    rule: RuleObject;
    condition: NoDataCondition;
}
interface NoDataLookup {
    conditions: NoDataConditionRef[];
    errors: {
        ruleId: string;
        errors: string[];
    }[];
}
/**
 * Reads one rule in either layout. `data` is null when nothing but Rule State (or nothing at all)
 * is stored under the ID.
 */
declare function getRule(client: DynamoDBDocumentClient, ruleId: string, options?: TableOptions): Promise<TransformResult<RuleObject | null>>;
/** Rules with a condition on the sensor, for the rule engine when a reading arrives. */
declare function findRulesBySensorId(client: DynamoDBDocumentClient, sensorId: string, options?: TableOptions): Promise<RuleLookup>;
/** Every no-data condition with its rule, for the no-data service. Callers check `enabled`. */
declare function findNoDataConditions(client: DynamoDBDocumentClient, options?: TableOptions): Promise<NoDataLookup>;
/** Rules owned by an account. v2 rules are read straight from the index; legacy rules need their items. */
declare function listRulesByOwner(client: DynamoDBDocumentClient, ownerId: string, options?: TableOptions): Promise<RuleLookup>;
/**
 * Writes a rule in the v2 layout in one transaction. A legacy rule is converted (its legacy items
 * are deleted); the Rule State is left untouched. Returns the validation errors when the rule is invalid.
 */
declare function putRule(client: DynamoDBDocumentClient, ruleObject: RuleObject, options?: TableOptions): Promise<ValidationResult>;
/**
 * Deletes every item of a rule, including its Rule State. Rules of up to 100 items are deleted in one
 * transaction; larger leftovers are deleted in several. Resolves to the number of items deleted.
 */
declare function deleteRule(client: DynamoDBDocumentClient, ruleId: string, options?: TableOptions): Promise<{
    deleted: number;
}>;

declare const RULE_STATE_METADATA_KEY = "state";
interface RuleState {
    /** ISO 8601 time of the latest trigger; null when the rule has never triggered. */
    lastTriggeredAt: string | null;
    /** True while the rule has triggered and not yet recovered. */
    triggered: boolean;
    /** ISO 8601 time of the latest recovery; null when it has never recovered. */
    recoveredAt: string | null;
    /**
     * Version of the stored state; 0 when no state item exists yet. Pass back the version you read:
     * putRuleState only writes when the stored version is still the same.
     */
    version: number;
}
type PutRuleStateResult = {
    ok: true;
    version: number;
} | {
    ok: false;
    conflict: boolean;
    errors: string[];
};
/** Reads the Rule State, falling back to the legacy lastTrigger item, then to the initial state. */
declare function getRuleState(client: DynamoDBDocumentClient, ruleId: string, options?: TableOptions): Promise<RuleState>;
/**
 * Writes the Rule State if nobody else wrote it since `state.version` was read (optimistic
 * concurrency between engine instances handling the same rule). On a version conflict nothing is
 * written and `conflict` is true: read the state again and retry.
 */
declare function putRuleState(client: DynamoDBDocumentClient, ruleId: string, state: RuleState, options?: TableOptions): Promise<PutRuleStateResult>;

declare const RULE_CHANGE_TOPIC = "notifyEngine/ruleChange";
declare const RULE_CHANGE_SCHEMA_VERSION = 2;
type RuleChangeType = "created" | "updated" | "deleted";
interface RuleChange {
    type: RuleChangeType;
    ruleId: string;
}
interface DecodedRuleChange extends RuleChange {
    /** `v2` for messages from encodeRuleChange, `legacy` for messages of the legacy API. */
    format: "v2" | "legacy";
    /** The legacy message string (`msg`), when there was one. */
    legacyMessage?: string;
}
/** Encodes a ruleChange message (a JSON string). Throws on an invalid change. */
declare function encodeRuleChange(change: RuleChange): string;
/** Decodes a ruleChange message in the v2 format or in either legacy format. */
declare function decodeRuleChange(payload: unknown): TransformResult<DecodedRuleChange>;

declare function normalizeRawItem(item: Record<string, unknown>): Record<string, unknown>;
declare function normalizeNotify(item: Record<string, unknown>): LegacyRuleNotify;
declare function normalizeCondition(raw: Record<string, unknown>): RuleConditionItem;
declare function normalizeMeta(raw: Record<string, unknown>): RuleMetaItem;
declare function normalizeController(raw: Record<string, unknown>): RuleControllerItem;
declare function fromLegacyDdbItems(items: RuleItem[]): TransformResult<LegacyRuleObject>;
declare function toLegacyDdbItems(ruleObject: LegacyRuleObject): TransformResult<RuleItem[]>;
declare function validateLegacyRuleObject(ruleObject: unknown): ValidationResult;
declare function normalizeLegacyRuleObject(ruleObject: LegacyRuleObject): LegacyRuleObject;

export { type ComparisonCondition, type ComparisonOperator, type Condition, type ConditionBase, type ConditionGroup, type ConditionOperator, type ConditionType, type ConditionUnit, DEFAULT_TABLE_NAME, type DecodedRuleChange, type DocumentTransactWriteItem, type GroupMode, type LegacyRuleNotify, type LegacyRuleObject, type LineRecipient, MAX_TRANSACTION_ACTIONS, type NoDataCondition, type NoDataConditionRef, type NoDataLookup, type Notify, type PutRuleStateResult, RULE_CHANGE_SCHEMA_VERSION, RULE_CHANGE_TOPIC, RULE_STATE_METADATA_KEY, type RuleChange, type RuleChangeType, type RuleConditionItem, type RuleController, type RuleControllerItem, type RuleItem, type RuleItemBase, type RuleItemKey, type RuleLastTriggerItem, type RuleLookup, type RuleMeta, type RuleMetaItem, type RuleMetadata, type RuleMinTriggerDurationItem, type RuleModeItem, type RuleNameItem, type RuleNotificationItem, type RuleNotificationValueLine, type RuleObject, type RuleOwnerItem, type RuleState, type Sustain, type TableOptions, type TransformResult, type ValidationResult, type WriteSet, decodeRuleChange, deleteRule, encodeRuleChange, findNoDataConditions, findRulesBySensorId, fromDdbItems, fromLegacyDdbItems, getRule, getRuleState, isNewLayout, listRulesByOwner, normalizeCondition, normalizeController, normalizeLegacyRuleObject, normalizeMeta, normalizeNotify, normalizeRawItem, putRule, putRuleState, toLegacyDdbItems, toTransactWriteItems, toWriteSet, validateLegacyRuleObject, validateRuleObject };
