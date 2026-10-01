# dsh-env

[中文](README.md) | English

> **AEmbers fork**, based on [`@hyzyn/dsh-env`](https://github.com/hyzyn/dsh-plugin-kit/tree/main/packages/env) (Apache-2.0).
> The DSH **Settings → Environment & secrets** page: manage `~/.dsh/env.yml` graphically (overridable with `DSH_ENV_FILE`); **secret plaintext goes into the official credential store by default**, so the env file never holds plaintext.

## What this fork changes

| Change | Detail |
|---|---|
| **Ships its own settings page** | Registers the official `settings.section` (id `env-secrets`, order 17), so a **Settings → Environment & secrets** entry always exists. Upstream outsources that entry to `@hyzyn/dsh-kit-settings` — **without that package the whole row disappears**, which is upstream's most common "plugin installed but no settings page" complaint. This fork is self-sufficient. |
| **Wider version range** | `peerDependencies.@deepseek-ai/dsh` and `dsh.engines.dsh` go from `^0.1.7-rc.2 \|\| ^0.2.0-rc.1 \|\| ^0.2.0-rc.2` to `>=0.1.7-rc.2`. DSH's compatibility gate evaluates peer ranges with `includePrerelease: true`, so later 0.2.x / 0.3.x lines need no range bump. |
| **Independent package name** | Renamed to `dsh-env` (was `@hyzyn/dsh-env`) so it never shadows the upstream npm package; both can coexist for comparison. |
| **Corrected copy** | The agent-facing capability announcement and the README entry descriptions now point at a page that actually exists. |
| **Standalone build** | Extracted from the monorepo into a self-contained repository; plain `tsc`, no dependency on `@hyzyn/dsh-plugin-kit` build scripts. |

## Features

- **Secret values never enter the env file**: secret values are written into the official credential store (the refs of `~/.dsh/.credentials.yaml`) and the env file keeps only the manifest; the API never returns plaintext (`value: null`), the GUI renders a password field, and saving with an empty field keeps the stored value.
- **`js:` expressions are evaluated late by the host**: expressions such as `js:process.env.API_KEY` stay in the file and are evaluated by the host (the YAML `!!js` dialect, the same as dsh patch files), so secrets need not be hard-coded.
- **Saving writes into the current process**: the resolved values are written into the current process's `process.env`, so the host and subsequently started child processes can use them at once — no restart needed.
- **Storage fallback is all-or-nothing**: when the host has no credential seam or `secretsInCredentials` is turned off, the plugin falls back to "env-file-only storage" and never writes a half-migrated state.
- **Fences and file permissions are explicit constraints**: routes are loopback + same-origin only, the env file is always 0600, and the docs explicitly warn against exposing the GUI port through tunnels / reverse proxies.

## Routes

Loopback + same-origin access only:

- `GET /api/dsh-env/list` — lists all environment variables (secret entries have a null value and never return plaintext; `storage: refs` means the value lives in the official credential store, `file` means it stays in the env file)
- `POST /api/dsh-env/save` — saves the whole set (validates key names, de-duplicates, then writes back; an entry whose value is null keeps its stored value; secret values are automatically written into the credential store, and on write failure they stay in the file and `warnings` are returned)

## Installation

Install straight from this repository (the repository root *is* the plugin package):

```bash
dsh plugin --profile <profile> add github:AEmbers/dsh-env
```

Link-install for local development:

```bash
pnpm install && pnpm build
dsh plugin --profile <profile> add link:/path/to/dsh-env
```

The plugin's own line is mounted by `insert: { id: env-manager, name: 'dsh-env' }` in `cordis.patch.yml`; saving environment variables writes them into `process.env` immediately, with no host process restart.

## Configuration

**Three entry points, one form**:

| Host | Entry |
|---|---|
| Any version (shipped by this fork) | **Settings → "Environment & secrets"** ← recommended |
| DSH ≥ `0.2.0-rc.1` | Plugins panel → select `dsh-env` → **inline on the detail page, directly below the description** |
| DSH `0.1.6` line | The row's ">" sub-page in the Plugins panel |
| DSH ≤ `0.1.5` | Settings → Plugins → the "Plugin configuration" tab |

When `@hyzyn/dsh-kit-settings` is installed, the same card also appears in its "Plugin configuration" row (collapsible form).

```ts
interface Config {
  /** Disable the whole plugin. Default false. */
  enabled?: boolean
  /** Whether to inject the plugin capability announcement to the agent. Default true. */
  announceToAgent?: boolean
  /** Whether to write resolved values into process.env on save/startup. Default true. */
  applyToProcessEnv?: boolean
  /** Whether secret values are stored in the official credential store (.credentials.yaml refs). Default true; when disabled, everything stays in the env file. */
  secretsInCredentials?: boolean
}
```

## Development

```bash
pnpm install
pnpm build       # tsc -p tsconfig.json → lib/
pnpm typecheck
pnpm test
```

`client.js` is the browser half and has **no build step** — it is the source, and the host ships it through `dsh-client-modules` along the boot graph. After editing it, just reload the page (hot-reloaded while the host runs `dsh web`).

## Note

- The managed block is marked with `# --- dsh-env-manager managed ...`; the plugin rewrites only that block and leaves everything else exactly as it is.
- **Credential-store migration**: on startup, secret entries that carry plaintext values are automatically migrated into the official credential store; it is idempotent and non-destructive — values are removed from the env file only for entries written successfully. Three kinds of entries stay in the env file: `js:` references, empty values (the official store rejects empty strings), and keys shadowed by the startup environment or already present in refs (**values the user stored through the official UI are not overwritten**).
- When the host provides no credential seam, or `secretsInCredentials: false` is configured, the plugin falls back entirely to env-file-only storage mode.
- Key names must match `[A-Za-z_][A-Za-z0-9_]*` and must not repeat.
- `js:` expressions are evaluated inside the host (the same trust model as the loader); only expressions this machine can resolve should be stored.
- The env file is always written to disk with 0600 (it carries the manifest and a small amount of legacy plaintext, and does not inherit pre-existing permissive permissions).
- Upgrade note: after migration the secret values live in `.credentials.yaml`, so rolling back to an older, pre-migration version of the plugin against the same `~/.dsh` is not recommended.
- Security note: the routes trust loopback + same-origin requests only and have no authentication — any process or tunnel that can reach the port with local loopback identity (such as an `ssh -L` port forward, or a local reverse proxy that rewrites Host to localhost) can read values that have not been migrated into the credential store; `js:` prefixed values are executed inside the host process, which is equivalent to local code execution. Do not expose the GUI port to untrusted networks through tunnels / proxies unless authentication is added on top.

## License

Apache-2.0, inherited from the upstream `hyzyn/dsh-plugin-kit`.
