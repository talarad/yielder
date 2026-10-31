# Setting up Yielder for free

About 15 minutes, no credit card. You need a free Cloudflare account and your Google account.

At the end you have:

- the app at `https://yielder.pages.dev` (or the name you pick), on your phone and computer;
- sign-in with Google that lasts for months, with your data in one file in your own Google Drive;
- market data refreshed every month by GitHub, for free;
- a repository that can stay private.

How it fits together: Cloudflare Pages serves the app and runs one small function,
`functions/api/auth` (code in `server/auth.ts`), that keeps your Google sign-in alive. Your data
never passes through it: the browser reads and writes your Drive file directly.

## 1. Put the site on Cloudflare Pages

1. Create a free account at <https://dash.cloudflare.com/sign-up>.
2. **Workers & Pages → Create → Pages → Import an existing Git repository**. Connect GitHub and
   allow Cloudflare to see only the `yielder` repository.
3. Pick **yielder**, then:
   - Project name: `yielder` (the address becomes `https://yielder.pages.dev`)
   - Production branch: `main`
   - Framework preset: `None`
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Environment variables: `NODE_VERSION` = `22`, and `VITE_GOOGLE_CLIENT_ID` = your Google
     Client ID (step 2.5)
4. **Save and Deploy.**

## 2. Google sign-in

1. Go to <https://console.cloud.google.com/> and create a project, for example `Yielder`.
2. **APIs & Services → Library**: search for **Google Drive API** and click **Enable**.
3. **Google Auth Platform → Branding**: app name `Yielder`, your email as the support and
   developer contact email, no logo (a logo needs Google's review), home page
   `https://yielder.pages.dev/`, privacy policy `https://yielder.pages.dev/privacy.html`,
   authorized domain `yielder.pages.dev`.
4. **Data access**: add `.../auth/drive.file`, `openid`, `.../auth/userinfo.email` and
   `.../auth/userinfo.profile`. They're all non-sensitive.
5. **Clients → Create client → Web application**, name `Yielder web`:
   - Authorized JavaScript origins: `https://yielder.pages.dev` (and `http://localhost:5173` to
     run it locally)
   - Authorized redirect URIs: `https://yielder.pages.dev/api/auth/callback`
   - Copy the **Client ID**, and under **Client secrets**, the secret (Google shows it once; you
     can always add a new one).
6. **Audience → Publish app.** (In Testing, Google ends sign-ins after 7 days and only listed test
   users can sign in.)
7. Back in Cloudflare: the project → **Settings → Variables and secrets**, for Production:
   - `VITE_AUTH` = `server` (text)
   - `GOOGLE_CLIENT_SECRET` = the secret (type **Secret**)

   Then **Deployments → … → Retry deployment** so the build picks them up.

To run it locally, create `.env.local` next to `package.json` with `VITE_GOOGLE_CLIENT_ID=…` and
run `npm run dev`. Locally (without the sign-in function) Google sign-in uses Google's own window
and lasts an hour, as on hosts without a server.

## 3. Move your data in

1. Open your site and click **Continue with Google**, and allow access to "the specific Google
   Drive files you use with this app". Keep that box ticked.
2. If you used Yielder before with the same Google project, your data is already there. Otherwise
   the dashboard is empty: click **Already have data? Open a Yielder file** and choose a Yielder
   file (or the old server database `data\yielder.db`).
3. The sidebar shows **Saved to Google Drive**, and `Yielder data.db` is in your Drive.

## 4. Monthly market data

Nothing to do: the repository's GitHub Actions job **Market data** runs on the 20th–25th of
every month, fetches the new month from data.gov.il and commits it when there's something new;
Cloudflare redeploys the site on that commit. You can run it by hand from the repository's
**Actions** tab → **Market data → Run workflow**.

## Good to know

- **Staying signed in**: Google keeps the sign-in for as long as you use Yielder at least every
  six months. Each device also keeps a copy of your file, so the app still opens without a
  connection. Signing out ends the sign-in and removes the copy from that device.
- **Two devices**: if the file changed on another device since you opened it, Yielder doesn't
  overwrite it; it asks whether to load the latest version or keep yours.
- **Backups**: Google Drive keeps earlier versions of the file (right-click → **Manage
  versions**), and **Settings → Download a copy** saves the whole file to your computer.
- **Leaving**: your data is a normal SQLite file. You can open it with any SQLite tool, or
  export everything to Excel from **Import → Export my data**.
- **Without Cloudflare**: any static host works, e.g. GitHub Pages with the repository's
  **Deploy** workflow (`.github/workflows/deploy.yml`; GitHub's free plan needs the repository
  public for that). There, Google sign-in lasts an hour; Yielder opens this device's copy after
  that and reconnects when you save.
