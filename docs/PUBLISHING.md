# Publishing n8n-nodes-sitelemetry

The package is published to npm by the owner with the owner's npm account. n8n discovers community nodes on npm by the keyword `n8n-community-node-package`; the verified listing (the badge in the node panel and availability on n8n Cloud) is a separate submission to n8n.

## 1. Before the first publish

- Create the public GitHub repository named in `package.json` (`repository.url`, `bugs.url`, the `documentationUrl` of the credential and the codex file) and push this package to it. Keep `dist/` out of git (`.gitignore` already does); npm builds it on publish. The repository must stay **public**: n8n's verification scan downloads the attested commit from it and fails the package outright if it cannot.
- The `author` block must carry a **non-empty `author.email`** — the scan's `valid-author` rule rejects the package without one, on both the source and the tarball. It is set to `support@sitelemetry.com`; npm shows it on the package page, so it has to be an address that is real and monitored.
- Check `name`, `version` (start at `0.1.0`), `description` and `keywords`.
- Authentication: **npm trusted publishing** (no token in the repository). On npmjs.com open the package → Settings → Trusted Publisher → GitHub Actions and enter organization `egenil`, repository `n8n-nodes-sitelemetry`, workflow filename `release.yml` (no environment). This page exists only after the first publish; 0.1.0 was published on 2026-09-21 with a one-time granular `NPM_TOKEN` secret, which is deleted afterwards (repository Settings → Secrets → Actions) together with the token on npmjs.com. Releases are published by the workflow, not from a laptop (see section 2).

## 2. Release checklist

Check locally first:

```sh
npm ci
npm run lint          # the same rules n8n's verification scan applies (see below)
npm test              # builds dist/, re-runs the lint, then the node:test suite against the local mock
npm pack --dry-run    # confirm the tarball contains only dist/, package.json, README.md, LICENSE
```

`npm run lint` mirrors `buildScanConfig()` from `@n8n/scan-community-package`: `@n8n/eslint-plugin-community-nodes` `configs.recommended` plus `no-console`, and the three `eslint-plugin-n8n-nodes-base` rule sets with the same rules disabled that the scanner disables. Keep `eslint.config.mjs` in step when the scanner is upgraded — the `n8n-nodes-base` rules alone do **not** cover what the scan checks.

The tarball must not contain source maps of anything secret, `.env` files or API keys; the package has no such files, and `files` in `package.json` restricts it to `dist/`.

### Publishing with provenance

**Do not publish from a laptop.** `npm publish` run locally produces no npm provenance attestation, and the verification scan treats provenance as mandatory: it stops before linting and reports `Package was not published with npm provenance`. Such a version can never be verified — only a newer, properly published one can.

Releases go through `.github/workflows/release.yml`, which runs `npm stage publish --provenance --access public` on a GitHub runner with `id-token: write`.

npm creates a trusted publisher with the **stage publish** permission only, so a plain `npm publish` from CI is refused with `403 OIDC permission denied for this action` (seen on 2026-09-23 for 0.1.1). Staging uploads the signed, provenance-attested tarball and parks it; a maintainer then approves it at <https://www.npmjs.com/settings/ozandikici/staged-packages> with their own 2FA and the version goes live. Nothing reaches the registry without that human step. The alternative is to tick "Allow npm publish" on the trusted publisher in the package settings and go back to `npm publish`. Update `CHANGELOG.md`, bump the version and push the tag; the tag push starts the workflow:

```sh
npm version patch|minor|major   # creates the commit and the vX.Y.Z tag
git push --follow-tags
```

`prepublishOnly` still runs the build, the lint and the tests inside the workflow before the upload.

## 3. After publishing

1. Run n8n's package scan against the published version:

   ```sh
   npx @n8n/scan-community-package n8n-nodes-sitelemetry
   ```

   The scan runs in three stages, and each one is a hard failure:

   1. **Provenance** — the published version must carry an npm provenance attestation (section 2).
   2. **Attested source** — it reads the GitHub repository and commit out of that attestation, downloads that commit and lints `package.json` and `{nodes,credentials}/**/*.{js,ts,json}`. An unreachable or private repository fails the scan.
   3. **Published tarball** — it lints the compiled `dist/**/*.js` and the published `package.json` separately, because provenance pins the source commit and not the build output.

   Stages 2 and 3 use the rule set `npm run lint` mirrors, so a green local lint is the best predictor. The scan also checks for runtime dependencies and restricted modules (`fs`, `child_process`, `process.env`, `eval`, network libraries outside n8n's helpers); this package uses none of them.

2. Install the published package on a test instance through **Settings > Community nodes > Install** and run the example workflow against a site you own with a Free-plan key: the Free security audit completes with `status: partial` and the plan facts, and a `seo` audit returns `status: plan_required` without starting an audit.

3. Within a few hours the package is searchable in the community nodes installer of every self-hosted instance (n8n reads the npm registry). No submission is needed for that.

## 4. Verified community node (optional, recommended)

n8n reviews community nodes on request and lists verified nodes in the node panel of all instances, including n8n Cloud. The submission form and the current requirements are on the n8n docs page "Submit your community node": <https://docs.n8n.io/integrations/creating-nodes/deploy/submit-community-nodes/>.

The requirements at the time of writing, all met by this package:

- Published on npm with the keyword `n8n-community-node-package`, MIT license, public source repository, and **published with npm provenance** from that repository.
- No runtime dependencies (`dependencies` is absent; `n8n-workflow` is a peer dependency).
- Only n8n's request helpers for HTTP; no `fs`, `child_process`, `process.env` or `eval`.
- `n8n.n8nNodesApiVersion`, `nodes` and `credentials` in `package.json`; a codex file next to the node; an SVG icon; `usableAsTool` set so the node can be used by AI agent nodes.
- Documentation of the credential (README section "Credentials") and of the operations.
- `author.email` is set, inputs and outputs use `NodeConnectionTypes.Main`, and no restricted global (`setTimeout`, `clearTimeout`, …) is used; waits go through `sleepWithAbort` from `n8n-workflow`.
- The lint rules of `@n8n/eslint-plugin-community-nodes` and `eslint-plugin-n8n-nodes-base` pass (`npm run lint`).

Submit the npm package name, the repository URL and a short description. Reviews take time; publish first so self-hosted users can install the node in the meantime.

## 5. Updating

For every change: update `CHANGELOG.md`, bump the version with `npm version`, push the tag and let the release workflow publish it with provenance. Instances update the node from **Settings > Community nodes** (an **Update** button appears next to the package). Verified nodes go through the n8n review again for new versions when the review process requires it.

## 6. What never goes into the package or the repository

- API keys, `.env` files, n8n exports containing credentials.
- Anything from a private Sitelemetry repository; this package only uses the public MCP endpoint and the public plan catalogue.
