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

## Upgrading from 0.3.x

0.4.0 replaces `RuleObject` with the v2 object above (incompatible change). The 0.3.x functions keep their behaviour under new names, for consumers still built around the legacy object:

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
npm i "git+ssh://git@github.com/crescendoCat/rule-transform-sdk.git#dist-v0.3.1"
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
