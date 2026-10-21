# rule-transform-sdk

The single definition of the SensorRule format (IoT-Platform-API ADR-0011). The API writes Sensor Rules through this SDK; the rule engine and the no-data service read them through it. Consumers depend on the domain object `RuleObject`, never on the DynamoDB item shape.

Terms (Sensor Rule, Condition Group, Condition, Rule Controller, Recovery Threshold, Cooldown, Rule State) follow the "控制" section of IoT-Platform-API's `CONTEXT.md`.

## `RuleObject` (v2)

`RuleObject` holds user settings only. Runtime state (last trigger time, whether the rule has triggered and not yet recovered) is the Rule State and is stored separately; it is not part of `RuleObject`.

### Sensor Rule

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | `string` | Rule ID. |
| `name` | `string` | Display name (may be empty). |
| `ownerId` | `string` | Account ID of the owner. |
| `areaId` | `string`, optional | Area the rule belongs to. Rules created before Areas were recorded may lack it. |
| `enabled` | `boolean` | A disabled rule is not judged. |
| `cooldownMs` | `number` ≥ 0 | Cooldown: minimum interval between two triggers, in milliseconds. |
| `groupMode` | `"any"` \| `"all"` | How the Condition Groups are combined. |
| `groups` | `ConditionGroup[]` | Condition Groups. A rule with no groups never triggers. |
| `ruleControllers` | `RuleController[]` | Controllers operated when the rule triggers. |
| `notify` | `Notify`, optional | The single notification channel. |
| `meta` | `RuleMeta`, optional | `createdAt`, `updatedAt` (ISO 8601) and `createdBy` (Account ID). |

### Condition Group

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | `string` | Unique within the rule. |
| `mode` | `"any"` \| `"all"` | How the conditions of the group are combined. |
| `conditions` | `Condition[]` | Must not be empty. Groups do not nest. |

### Condition

Every condition has:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | `string` (UUID) | Unique within the rule. No longer derived from the sensor and operator. |
| `sensorId` | `string` | Sensor whose readings are judged. |
| `operator` | `<` `>` `=` `<=` `>=` `!=` `no-data` | |
| `enabled` | `boolean` | A disabled condition is treated as absent; if all conditions are disabled the rule never triggers. |
| `name` | `string`, optional | Display name. |

A comparison condition (`operator` other than `no-data`) also has:

| Field | Type | Meaning |
| --- | --- | --- |
| `threshold` | `number` | Trigger threshold. Decimals are kept. |
| `recoveryThreshold` | `number`, optional | Recovery Threshold. Once met, the condition stops holding only after readings cross it. Defaults to `threshold`. |
| `sustain` | `Sustain` | How long the comparison must keep holding (see below). |

A no-data condition (`operator: "no-data"`) has no threshold and instead:

| Field | Type | Meaning |
| --- | --- | --- |
| `noDataMinutes` | `number` > 0 | Holds when the sensor has sent no readings for this many minutes. |

`Sustain` is one of:

| Shape | Meaning |
| --- | --- |
| `{ type: "count", n }` | The latest `n` readings all satisfy the comparison. `n` is a positive integer. |
| `{ type: "ratio", windowMinutes, percent }` | Within the last `windowMinutes`, at least `percent`% of readings satisfy it. `windowMinutes` > 0, 0 < `percent` ≤ 100. |
| `{ type: "continuous", minutes }` | The comparison has held for `minutes` (> 0), judged on received readings only: a gap in readings does not break it (that is what no-data conditions are for). |

### Notify

| Shape | Meaning |
| --- | --- |
| `{ type: "line", recipient: { id_type, id_name } }` | LINE recipient as bound in `Notification.line_list`; `id_type` is `"user"` or `"group"`. |
| `{ type: "email", recipient }` | E-mail address. |
| `{ type: "telegram", recipient }` | Telegram chat ID. |

### Rule Controller

| Field | Type | Meaning |
| --- | --- | --- |
| `controllerId` | `string` | Unique within the rule. |
| `name` | `string`, optional | Display name of the controller. |
| `value` | `number` | Target value; the engine uses it as the work cycle. |
| `enabled` | `boolean` | A disabled rule controller is not operated. |

## Functions

- `validateRuleObject(ruleObject)`: checks a v2 `RuleObject` and returns `{ ok, errors }`, each error naming the field path (for example `groups[0].conditions[1].sustain.percent must be greater than 0 and at most 100`). Values are checked, never converted.
- `fromDdbItems(items)`: reads all items of one rule, in either storage layout, as a `RuleObject`. Accepts DocumentClient items and raw AttributeValue items. Returns `{ ok: true, data }` or `{ ok: false, errors }`.
- `isNewLayout(items)`: `true` when the rule is stored in the v2 layout. The legacy API (v1) uses it to refuse writes to v2 rules and to skip them when reading.
- `toWriteSet(ruleObject, previousItems?)`: the items to put and the keys to delete so that the rule ends up in the v2 layout. Pass every item currently stored for the rule (a query on `ruleId`) as `previousItems`: whatever they contain that the new write does not put is deleted (all legacy items when converting a legacy rule, index items of sensors no longer referenced). Rule State items (`lastTrigger`, `state`) are kept. Fails when the write would need more than 100 actions.
- `toTransactWriteItems(writeSet, tableName = "SensorRule")`: turns a write set into `TransactItems` for DocumentClient's `TransactWriteCommand`, so the whole write is one transaction.

### DynamoDB access

Every function below takes a v3 `DynamoDBDocumentClient` as its first argument; the SDK never creates a client, so the endpoint, region and credentials are the caller's choice. The last argument is optional `{ tableName }` (default `"SensorRule"`). Queries find rules in both layouts and follow pagination. Problems with the data are returned as results; DynamoDB errors reject.

| Function | Use |
| --- | --- |
| `getRule(client, ruleId)` | `{ ok: true, data: RuleObject }`, `{ ok: true, data: null }` when the rule does not exist, or `{ ok: false, errors }` when its items cannot be read. |
| `findRulesBySensorId(client, sensorId)` | For the rule engine when a reading arrives: `{ rules, errors }`, the rules with a condition on the sensor plus the rules that could not be read. |
| `findNoDataConditions(client)` | For the no-data service: `{ conditions: [{ rule, condition }], errors }`. Disabled rules and conditions are included; check `enabled`. |
| `listRulesByOwner(client, ownerId)` | `{ rules, errors }` for one owner. |
| `putRule(client, ruleObject)` | Writes the rule in the v2 layout in one transaction; a legacy rule is converted. Never touches the Rule State. Returns `{ ok, errors }` (validation errors). |
| `deleteRule(client, ruleId)` | Deletes every item of the rule, the Rule State included. Resolves to `{ deleted }`. |

### Rule State

The Rule State is written only by the rule engine and is stored apart from the rule definition (`metadata: "state"` in the same table).

```ts
interface RuleState {
  lastTriggeredAt: string | null; // ISO 8601
  triggered: boolean;             // triggered and not yet recovered
  recoveredAt: string | null;     // ISO 8601
  version: number;                // 0 when no state is stored yet
}
```

- `getRuleState(client, ruleId)`: the stored state; for a legacy rule without a state yet, the legacy `lastTrigger` item gives `lastTriggeredAt`.
- `putRuleState(client, ruleId, state)`: writes the state only if the stored version is still `state.version` (the version you read), and stores `version + 1`. When another engine instance wrote first it returns `{ ok: false, conflict: true }` and writes nothing: read again and retry. On success it returns `{ ok: true, version }`.

### ruleChange messages

The API publishes a message on `RULE_CHANGE_TOPIC` (`notifyEngine/ruleChange`) after every change to a Sensor Rule.

- `encodeRuleChange({ type, ruleId })`: `type` is `"created"`, `"updated"` or `"deleted"`. Returns the JSON string to publish.
- `decodeRuleChange(payload)`: accepts a string, bytes or an object. Understands the v2 format and both legacy formats (v1's `add-rule`, `delete-rule`, `update-condition`, `delete-condition`, `update-notification`, `delete-notification`, `delete-controller`, and `/api/v2/sensor-rule`'s `Rule created`, `Condition updated`, ...). A change to part of a rule decodes as `"updated"`. Returns `{ ok: true, data: { type, ruleId, format, legacyMessage? } }` or `{ ok: false, errors }`.

## Storage

The storage layout is internal to the SDK; consumers only see `RuleObject`. Since 0.4.1 a rule is written as one definition item (`metadata: "definition"`, with `schemaVersion: 2`, `ownerId` and the whole `RuleObject`) plus one index item per referenced sensor (`metadata: "sensor#<sensorId>"`, with `sensorId`, and `condition: "no-data"` when a no-data condition uses the sensor), in the existing `SensorRule` table and its GSIs. The definition item carries no `sensorId` or `condition`, so it stays out of `sensorId-index` and `condition-index`; index items carry no `ownerId`, so they stay out of `ownerId-ruleId-index`. Items written by a newer schema version are refused rather than overwritten.

### Reading legacy rules

Rules in the legacy layout (one item per `owner`, `name`, `ruleMode`, `minTriggerDuration`, `notification`, `meta`, `condition-*`, `controller-*`, `lastTrigger`) are read as follows. Empty strings count as absent; numeric strings are parsed.

| Legacy data | `RuleObject` |
| --- | --- |
| no `owner` item, or empty `ownerId` | error: every legacy write path stores an owner, so these are leftovers of a broken write |
| `owner.areaId` missing | `areaId` absent |
| `name` item missing | `name: ""` |
| `ruleMode` `any` / `all` / missing | one Condition Group with that `mode` (missing → `all`); any other value is an error. `groupMode` is `all` |
| no condition items | `groups: []` |
| `minTriggerDuration` | `cooldownMs`; missing or negative (the legacy "not set" value `-1`) → `0` |
| any rule | `enabled: true` |
| `lastTrigger` item | not part of `RuleObject` (it is the initial Rule State) |
| condition `id` | UUID v5 derived from `ruleId` and the condition's `metadata`, so the same rule gives the same IDs on every read |
| condition without `sensorId`, or with an unknown operator | error |
| `conditionName` | `name` |
| comparison condition without `value` | error |
| `conditionUnit: "Percent"` | `{ type: "ratio", windowMinutes: duration × 60, percent: conditionLimit }`; error without a positive `duration` or with `conditionLimit` outside (0, 100] |
| `conditionUnit: "Times"` (with `Continual` or `Duration`) | `{ type: "count", n: conditionLimit }`. The window of `Duration` + `Times` cannot be expressed in v2 and is dropped |
| `conditionUnit` missing (written by `/api/v2/sensor-rule`) | read as `Times` |
| `conditionLimit` missing for `Times` | `n: 1`; a value that is not a positive integer is an error |
| unknown `conditionUnit` or `conditionType` | error |
| `no-data` condition | `{ operator: "no-data", noDataMinutes: duration × 60 }`; `value`, `conditionType`, `conditionUnit`, `conditionLimit` are ignored; error without a positive `duration` |
| `controller-<id>` | `controllerId` from the metadata (or `controllerId`), `name` from `controllerName`, `value`; `enabled: false` only when `activate` is `false`. Missing `value` is an error |
| `notification` `line` with `{ id_type, id_name }` (or `idType`, `idName`) | `notify: { type: "line", recipient }`; an object without a valid `id_type` / `id_name` is an error |
| `notification` `line` with a string (a LINE Notify token) | no `notify`: LINE Notify has shut down |
| `notification` `email` / `telegram` | `notify` with the string recipient; no `notify` when the value is empty |
| `notification` without a type or with another type | no `notify` (the rule is still judged) |
| other metadata | ignored |

## Upgrading from 0.3.x

0.4.0 replaces `RuleObject` with the v2 object above (incompatible change). The 0.3.x functions keep their behaviour under new names, for consumers still built around the legacy object. 0.4.0 shipped only the v2 types and validation; the storage layout (`fromDdbItems`, `isNewLayout`, `toWriteSet`), the queries and the Rule State arrived in 0.4.1 — depend on 0.4.1 or later.

| 0.3.x | 0.4.0 |
| --- | --- |
| `RuleObject`, `RuleNotify` (types) | `LegacyRuleObject`, `LegacyRuleNotify` |
| `fromDdbItems` | `fromLegacyDdbItems` |
| `toDdbItems` | `toLegacyDdbItems` |
| `validateRuleObject` | `validateLegacyRuleObject` (`validateRuleObject` now validates the v2 object) |
| `normalizeRuleObject` | `normalizeLegacyRuleObject` |

`normalizeRawItem`, `normalizeCondition`, `normalizeController`, `normalizeNotify`, `normalizeMeta` and the legacy item types (`RuleItem`, `RuleConditionItem`, ...) are unchanged.

## Install

```bash
npm i @crescendoCat/rule-transform-sdk
```

The DynamoDB functions need `@aws-sdk/lib-dynamodb` (v3), declared as a peer dependency so that the SDK uses the consumer's copy.

For GitHub Packages, consumer projects need `.npmrc`:

```ini
@crescendoCat:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN
```

### Install from git (fast, prebuilt)

Do **not** install from `main` or `vX.Y.Z` tags: those refs have a `prepare` script, so npm
downloads all devDependencies (tsup/esbuild, vitest, typescript) and builds on every install.

Use the prebuilt refs produced by the `Release Dist` workflow instead (no scripts, `dist/` included):

```bash
# pinned version (recommended)
npm i "git+ssh://git@github.com/crescendoCat/rule-transform-sdk.git#dist-v0.4.1"
# latest release
npm i "git+ssh://git@github.com/crescendoCat/rule-transform-sdk.git#dist"
```

Pushing a `vX.Y.Z` tag (e.g. via `npm version patch && git push --follow-tags`) creates
`dist-vX.Y.Z` and updates the `dist` branch. To backfill an existing tag, run the workflow
manually with `ref` set to that tag.

## Development

```bash
npm ci
npm test
npm run typecheck
npm run build
```

## Publish to GitHub Packages

1. Update package name and repository in `package.json`.
2. Create a GitHub Release, or run the `Publish Package` workflow manually.
3. Workflow uses `GITHUB_TOKEN` to publish.

## Local publish (optional)

```ini
# .npmrc (do not commit)
@crescendoCat:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_TOKEN
```

```bash
npm publish
```
