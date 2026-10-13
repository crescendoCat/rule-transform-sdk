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
