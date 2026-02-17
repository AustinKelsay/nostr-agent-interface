# Release Process

This document outlines the release process for `nostr-agent-interface`.

## Quick Release Steps

### 0. Prep on `staging`

1. Pull latest `staging`.
2. Confirm clean working tree.
3. Confirm `CHANGELOG.md` has an accurate `[Unreleased]` section.
4. Confirm docs still reflect project positioning: Nostr Agent Interface extends Nostr MCP Server, preserves JARC contracts, prefers CLI/API for operations, and keeps MCP as supported compatibility mode.

### 1. Run Pre-release Checks

```bash
bun run prerelease
```

Equivalent manual checks:

```bash
bun test
bun run build
bun run check:docs
```

### 2. Update Version Number

```bash
bun run release:patch
bun run release:minor
bun run release:major
```

These run `bun run prerelease` first, then `npm version ...`.

### 3. Finalize `CHANGELOG.md`

1. Move `[Unreleased]` items into the version being shipped.
2. Add release date.
3. Add a fresh empty `[Unreleased]` section.

### 4. Commit and Tag

```bash
git add CHANGELOG.md package.json package-lock.json artifacts/tools.json
git commit -m "Release vX.Y.Z"
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin main
git push origin vX.Y.Z
```

### 5. Create GitHub Release

1. Open [https://github.com/AustinKelsay/nostr-agent-interface/releases](https://github.com/AustinKelsay/nostr-agent-interface/releases)
2. Draft a release from the new tag.
3. Copy the matching `CHANGELOG.md` section into release notes.
4. Publish.

### 6. Publish to npm

```bash
npm publish
```

## Version Guidelines

1. Patch (`0.0.X`): fixes, docs, non-breaking polish
2. Minor (`0.X.0`): new capabilities, non-breaking
3. Major (`X.0.0`): breaking contract changes

## Pre-release Checklist

- [ ] `staging` includes intended release commits
- [ ] tests pass (`bun test`)
- [ ] build succeeds (`bun run build`)
- [ ] docs links pass (`bun run check:docs`)
- [ ] `README.md` and `llm/` docs match current interface strategy
- [ ] `artifacts/tools.json` reflects current tools
- [ ] no logs interfere with MCP JSON stream behavior

## Release Notes Template

```text
## What's Changed

### Added
- ...

### Changed
- ...

### Fixed
- ...

### Docs
- ...

**Full Changelog**: https://github.com/AustinKelsay/nostr-agent-interface/compare/vA.B.C...vX.Y.Z
```
