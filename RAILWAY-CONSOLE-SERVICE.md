# Deploying Ciao Business (the standalone console) on Railway

Everything is on `main` (commit `2734b73`). The console needs one new Railway
service plus two variable changes on existing services. Same recipe as the
partner app, with the lessons from that deploy baked in.

## 1. Create the service

In project `tender-purpose` (env `production`):

- **New service** from the GitHub repo `Salemandoliver/Ciao`, branch `main`.
- **Name**: `@ciao/console` — and don't rename it later: renaming a Railway
  service releases its generated domain and Railway does not mint a
  replacement (this bit the partner app on 3 August).
- **Dockerfile path**: `apps/console/Dockerfile`
- **Start command**: leave **EMPTY** (the Dockerfile CMD is correct; Railway
  does not shell-interpret start commands).
- **Generate a domain** for it (Settings → Networking). Note it — you'll need
  it twice below. Something like `ciao-console.up.railway.app`.

## 2. Variables — set BEFORE triggering the first real deploy

Variables only apply to deploys started after the change, so set them first,
then deploy.

On the **new `@ciao/console` service**:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | `https://ciaoapi-production.up.railway.app` |
| `HOSTNAME` | `0.0.0.0` |

(`NEXT_PUBLIC_API_URL` is a **build-time** arg — it is baked into the client
bundle, which is why changing it requires a rebuild, not a restart.)

On the **existing `@ciao/api` service** (two changes):

| Variable | Value |
| --- | --- |
| `CONSOLE_BASE_URL` | `https://<the console domain you generated>` |
| `CORS_ORIGINS` | append `,https://<the console domain>` to the current value |

The API now trims spaces, trailing slashes and empty entries in
`CORS_ORIGINS`, so the exact formatting is forgiving — but each origin still
has to be there. After the API redeploys, you can verify from a browser on the
console domain: `GET /health` reports `callerOriginAllowed: true` when the
console's origin is in the list.

## 3. Deploy order

1. Set the API variables → redeploy `@ciao/api` (it also runs the new
   migration `0012` creating `biz_credentials` / `biz_sessions` on boot).
2. Deploy `@ciao/console`.
3. If a push doesn't auto-deploy within ~5 minutes, trigger
   `serviceInstanceDeployV2` manually — the webhook occasionally misses.

## 4. The first account (chicken and egg, resolved by CLI)

Team invites are minted *from* the console, so the first account cannot come
from an endpoint. Run the CLI against the production database once:

```bash
DATABASE_URL='<the Railway Postgres public URL>' \
  pnpm --filter @ciao/api exec tsx src/db/set-biz-password.mts 0910000001 'a-long-password'
```

- The user must already hold `admin`, `ops` or `finance` (the seeded admin
  `0910000001` is `admin`). The script grants credentials, never roles.
- It sets `mustChange`, so the first sign-in lands on Security with a banner
  to pick a real password.
- After that, every further account comes from the console's **Users** screen:
  set the person's role, then "Send set-password link" — a one-time link,
  valid 7 days. Nobody at Ciao ever sees a password.

## 5. Verify

- `https://<console domain>/login` renders the Ciao Business sign-in.
- Sign in with the admin number → ten tabs, role shown in the header.
- A marketplace token is refused: the old `/biz` on the marketplace is now
  404, and `/v1/biz/overview` with a marketplace token answers 403.
- Sign in as a `finance` user (when you create one) → three tabs only:
  Overview, Finance, Audit log, plus Security.

## 6. When ciao.ly is bought

`console.ciao.ly` (or `biz.ciao.ly`) as a custom domain on this service, then
update together, exactly like the partner checklist: `CONSOLE_BASE_URL`,
`CORS_ORIGINS` on the API, and `NEXT_PUBLIC_API_URL` stays as-is unless the
API moves too. Rebuild the console after any `NEXT_PUBLIC_API_URL` change.
