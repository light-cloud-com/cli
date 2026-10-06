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

Type the 8-character code it prints at `console.light-cloud.com/device` from any device (approve the link in the email we send for a new address). That creates the account on the Free plan — no card, no password, no form — and signs the terminal in. `lc billing upgrade lite` later, when you want a paid plan: one Stripe Checkout takes the card and the first payment, and the card never passes through `lc`.

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
| `lc domains`, `lc domains add/check/retry/remove` | Custom domains. `www` and the root are set up together. Shows a live DNS check, which records are required or optional, which to delete, and says when a domain has a certificate but does not point here. `add --force` replaces a working domain before the new one's DNS is ready. Custom domains come with the paid plans: on Free `add` is refused with `PLAN_ENTITLEMENT`, and the hint names the plan to upgrade to. A domain already on a Free workspace goes on hold 14 days after the owner is emailed, until the workspace is on a paid plan |
| `lc folders`, `lc folder create/delete` | Folders that group apps and databases |
| `lc stack create <id>` | An app from a stack template (e.g. Open SaaS) |
| `lc dbs`, `lc db create/get/update/url/rotate-password/dump/import/schema/query/metrics/delete` | Databases: lifecycle, connection string, backups, schema, SQL, metrics |
| `lc billing`, `lc billing plans`, `lc billing upgrade <plan> [--annual]`, `lc billing card add/remove` | Plan, included usage, a one-step upgrade and the payment card (both through Stripe-hosted pages). `lc billing plan use` is the same as `upgrade` |
| `lc billing usage/history/invoices/invoice/outstanding/alerts/details` | Usage, invoices, usage alerts, billing address and tax ids |
| `lc members`, `lc member invite/remove/role`, `lc roles` | Workspace members |
| `lc keys`, `lc key create/revoke` | API keys for CI (paid plans; the secret is shown once) |
| `lc git connect/repos/github-status` | One link to connect GitLab or Bitbucket; the GitHub App install link |
| `lc profile`, `lc devices`, `lc device sign-out`, `lc agent-access` | Your name and time zone; signed-in sessions; what agents may do |
| `lc notifications`, `lc support` | Notifications; a message to support |
| `lc config`, `lc unlink` | Endpoint settings; remove the link file |

Every command takes `--json`, `--org <workspace>`, `--yes` and `--api-url`.

Settings → Security → **Agents & CLI** in the console can switch the CLI off, or keep groups of actions (deploy, delete, settings, databases, billing, workspace, API keys) console-only. A refused command says so and names the setting; the session `lc login` receives is marked as the CLI's, so the switch holds regardless of flags.

## Plans and billing

Every workspace starts on **Free**: $1 of usage a month, unlimited static sites, 3 server apps, no card. When Free's $1 is used up, server apps and deploys pause until the next cycle and static sites keep serving; a free workspace is never billed. Paid plans include usage worth their price, and extra usage goes on the next invoice (unless you chose a usage limit at checkout). Annual billing is two months free.

- `lc billing` — the plan, the card on file, and usage this cycle against what the plan includes; says when the workspace is paused and which plan brings it back.
- `lc billing plans` — every plan with its monthly and annual price, the usage it includes, and its limits.
- `lc billing upgrade <plan> [--annual]` — moves to a plan in one step. With a card on file it is charged at once; without one, a Stripe Checkout page (opened here, or a link for any device with `--no-browser`) takes the card and the first payment together, and the plan switches as soon as Stripe confirms. Downgrades wait for the end of the paid period.
- `lc billing usage` — usage this cycle per app and database, removed ones included.
- `lc billing alerts [--at <usd> | --clear]` — the 80% and 100% emails always send; add one extra alert at a dollar amount. Shows the usage limit on paid plans.

A command refused by a plan limit names the plan that includes it, with the command to run: `Lite includes it ($5 a month): run lc billing upgrade lite`.

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
