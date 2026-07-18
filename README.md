# rule-transform-sdk

A TypeScript SDK for converting SensorRule DynamoDB items into a normalized `RuleObject`, and converting it back safely.

## Why this package

The DynamoDB storage model and business-friendly object model can diverge over time. This SDK provides one canonical transform layer to reduce conversion bugs across services.

## Features

- `fromDdbItems(items)`: parse DynamoDB-style items into `RuleObject`
- `toDdbItems(ruleObject)`: convert `RuleObject` back to items
- `validateRuleObject(ruleObject)`: validate consistency before writing
- `normalizeRuleObject(ruleObject)`: fill defaults and normalize shape

## Install

```bash
npm i @YOUR_GITHUB_ID/rule-transform-sdk
```

For GitHub Packages, consumer projects need `.npmrc`:

```ini
@YOUR_GITHUB_ID:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN
```

## Development

```bash
npm ci
npm test
npm run build
```

## Publish to GitHub Packages

1. Update package name and repository in `package.json`.
2. Create a GitHub Release, or run the `Publish Package` workflow manually.
3. Workflow uses `GITHUB_TOKEN` to publish.

## Local publish (optional)

```ini
# .npmrc (do not commit)
@YOUR_GITHUB_ID:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_TOKEN
```

```bash
npm publish
```
