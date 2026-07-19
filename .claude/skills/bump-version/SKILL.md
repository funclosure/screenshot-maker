---
name: bump-version
description: Use when cutting a release of screenshot-maker — bumping the version, updating the changelog, tagging vX.Y.Z, or publishing a GitHub release.
---

# Bump Version / Cut a Release

Semver policy: the CLI surface is the public API (`--help` contract, scene
state keys, batch manifest format). Breaking those = major; new scene keys,
presets, or flags = minor; fixes = patch.

## Steps (in order)

1. **Preflight:** `git status` clean, on `main`, `git pull` up to date.
2. **Test gate:** `npm test` — all Playwright tests green (~2 min). A release
   with failing or skipped tests is not a release; fix first.
3. Bump the version in **both** `package.json` and `package-lock.json`
   (root `.version` and `.packages[""].version`).
4. Add a `## X.Y.Z — YYYY-MM-DD` section at the top of `CHANGELOG.md`
   covering `git log v<previous>..HEAD`, in the existing entry style.
5. Commit: `Release X.Y.Z: <one-line summary>`.
6. Annotated tag: `git tag -a vX.Y.Z -m "<one-line summary>"`.
7. Push both: `git push && git push origin vX.Y.Z`.
8. GitHub release, matching the existing title style
   (`vX.Y.Z — <short headline>`):
   `gh release create vX.Y.Z --title "vX.Y.Z — <headline>" --notes "<highlights, see CHANGELOG>"`.
9. **Verify:** `gh release view vX.Y.Z` shows the release and
   `git describe --tags` reports `vX.Y.Z`.

## Common mistakes

- Releasing without running `npm test` — the suite is the only gate.
- Bumping `package.json` but not `package-lock.json`.
- Lightweight tag (`git tag vX.Y.Z`) instead of annotated (`-a`).
- Pushing the commit but forgetting to push the tag.
