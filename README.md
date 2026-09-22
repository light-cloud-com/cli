# Light Cloud CLI

`lc` is the Light Cloud command line: deploy an app and watch the build stream
by, tail runtime logs, set environment variables, roll back, manage databases.
Everything the console does for an app, from the terminal, with `--json` for
scripts.

```
$ lc deploy
┌  ☁ Light Cloud deploy
│
│  my-app → production ★
│  Source: github.com/acme/my-app @ main
│
◇  Deployment queued  my-app / production
◇  Cloning repository  2.1s
◇  Building image  58s
◇  Deploying container  14s
◇  Deployed in 1m 16s  https://my-app.acme.light-cloud.io
│
└  Live at https://my-app.acme.light-cloud.io
```

## No account yet? Start here

```
$ npx @light-cloud/cli login --device --email you@example.com
```

Type the 8-character code it prints at `console.light-cloud.com/device` from any device (approve the link in the email we send for a new address). That creates the account — free plan, no password, no form — and signs the terminal in. `lc billing card add --plan pro` later, when you need a paid plan; the card goes through a Stripe-hosted link, never through `lc`.

## Install

```bash
npm install -g @light-cloud/cli
lc --version
```

Node 18.17 or newer. `lc` and `light-cloud` are the same binary.

## First run

```bash
lc login          # opens the browser; tokens land in ~/.lightcloud/credentials.json
cd my-project
lc init           # link the folder to an existing app, or create one
lc deploy         # deploy and follow the build
lc logs -f        # tail runtime logs
```

`lc login` shares its credential file with the Light Cloud MCP server, so
signing in once serves both.

## Commands

Everything the console can do, as commands. Console-only by design: the account password, two-factor, and the Agents & CLI switch. Copy-ready reference for every command: https://docs.light-cloud.com/deploy-with-ai/cli#command-reference

| Command | What it does |
|---|---|
| `lc login` / `logout` / `whoami` | Browser sign-in, `lc login --device` for a code from any device, or `lc login --api-key lc_…` for machines |
| `lc orgs`, `lc org use/current/create` | Workspaces; choose the default one; create a new one |
| `lc init`, `lc create [--upload] [--password <pw>]` | Link this folder to an app; create one from a repository or an upload, optionally behind a visitor password |
| `lc apps [filter]`, `lc status [app]`, `lc open`, `lc rename`, `lc delete` | Apps in the workspace and one app in detail |
| `lc app update/move/repo-dirs` | Build settings and defaults; folders; monorepo folders in a repository |
| `lc deploy [app] [--env x] [--upload]` | Deploy and follow; `--no-watch` to just queue |
| `lc envs`, `lc env get/create/update/delete/scale/password` | Environments, their settings, the visitor password gate |
| `lc env vars [set/unset/import/export]` | Environment variables; `--redeploy` to apply |
| `lc env metrics/activity/runtime` | Metrics, who changed what, what is running now |
| `lc logs [-f] [--since 2h] [--min-severity WARNING] [--search text]` | Runtime logs |
| `lc deployments`, `lc deployment <id>`, `lc rollback [id]` | History, the build log of one deployment, roll back without a rebuild |
| `lc domains add/check/retry/remove` | Custom domains with the DNS records to create |
| `lc folders`, `lc folder create/delete` | Folders that group apps and databases |
| `lc stack create <id>` | An app from a stack template (e.g. Open SaaS) |
| `lc dbs`, `lc db create/get/update/url/rotate-password/dump/import/schema/query/metrics/delete` | Databases: lifecycle, connection string, backups, schema, SQL, metrics |
| `lc billing`, `lc billing plans`, `lc billing plan use`, `lc billing card add/remove` | Plan, included usage and payment card (card via a Stripe-hosted link) |
| `lc billing usage/history/invoices/invoice/outstanding/alerts/details` | Usage, invoices, usage alerts, billing address and tax ids |
| `lc members`, `lc member invite/remove/role`, `lc roles` | Workspace members |
| `lc keys`, `lc key create/revoke` | API keys for CI (paid plans; the secret is shown once) |
| `lc git connect/repos/github-status` | One link to connect GitLab or Bitbucket; the GitHub App install link |
| `lc profile`, `lc devices`, `lc device sign-out`, `lc agent-access` | Your name and time zone; signed-in sessions; what agents may do |
| `lc notifications`, `lc support` | Notifications; a message to support |
| `lc config`, `lc unlink` | Endpoint settings; remove the link file |

Every command takes `--json`, `--org <workspace>`, `--yes` and `--api-url`.

Settings → Security → **Agents & CLI** in the console can switch the CLI off, or keep groups of actions (deploy, delete, settings, databases, billing, workspace, API keys) console-only. A refused command says so and names the setting; the session `lc login` receives is marked as the CLI's, so the switch holds regardless of flags.

## How a folder is linked

`lc init` writes a `.lightcloud` file:

```json
{
  "organisationId": "…",
  "applicationId": "…",
  "environmentId": "…",
  "applicationName": "my-app",
  "framework": "nextjs",
  "deploymentType": "container"
}
```

Commands run from that folder (or any subfolder) act on that app. The same
file is read by the MCP server and the VS Code extension. Commit it if the
whole team deploys the same app; ignore it if not.

## CI and scripts

Create an API key in the console (Organisation settings → API keys; paid
plans), then:

```bash
export LIGHT_CLOUD_API_KEY=lc_…
lc deploy --yes            # in a folder with .lightcloud
lc apps --json | jq '.[].name'
```

An API key is bound to one workspace, so `--org` is not needed. Without a
terminal, prompts are never shown: anything that would have asked fails with
the flag to pass instead.

Exit codes: `0` ok · `1` error · `2` usage · `3` not signed in · `4` not found ·
`5` the deployment or provisioning failed · `130` cancelled.

## Staging or a local API

```bash
lc config set api-url https://api.staging-light-cloud.com
# or per command
LIGHT_CLOUD_API_URL=http://localhost:5001 lc apps
```

The console URL is inferred from the API URL (`api.` → `console.`); override it
with `lc config set console-url …` or `LIGHT_CLOUD_CONSOLE_URL`.

## Development

```bash
npm install
npm run dev -- apps            # run from source
npm run typecheck
npm test
npm run build                  # dist/index.js, single file
node dist/index.js --help
```

Framework detection rules live in `src/lib/detection/catalogue.ts`, a snapshot
of the backend catalogue; the header of that file says how to regenerate it.
