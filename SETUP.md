# Setting up Yielder for free

About 15 minutes. You need a Google account (you have one) and a free Cloudflare account. No
credit card anywhere.

At the end you have:

- the app at an address like `https://yielder-abc.pages.dev`, on your phone and computer;
- sign-in with Google, with your data in one file in your own Google Drive;
- market data refreshed every month by GitHub, for free.

## 1. Put the site on Cloudflare Pages

1. Create a free account at <https://dash.cloudflare.com/sign-up>.
2. In the dashboard: **Workers & Pages → Create → Pages → Connect to Git**. Allow Cloudflare to
   see your GitHub account; you can limit it to the `yielder-v2` repository.
3. Pick **yielder-v2** and fill in:
   - Production branch: `main`
   - Framework preset: `None`
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Environment variable: `NODE_VERSION` = `22`
4. **Save and Deploy.** When it finishes, note the address it gives you (`https://….pages.dev`).
   You need it in step 2.

The site already works now with **Use in this browser only**. "Continue with Google" says it's
not set up yet; that's the next step.

## 2. Turn on "Continue with Google"

1. Go to <https://console.cloud.google.com/> and create a project, for example `Yielder`.
2. **APIs & Services → Library**: search for **Google Drive API** and click **Enable**.
3. **Google Auth Platform** (or "OAuth consent screen"):
   - App name `Yielder`, your email as the support and contact email.
   - Audience: **External**, and leave it in **Testing**. Under **Test users**, add your own
     Gmail address. (Only test users can sign in. That's you.)
   - Data access: add the scopes `.../auth/drive.file`, `openid`, `.../auth/userinfo.email`
     and `.../auth/userinfo.profile`. They're all non-sensitive, so Google doesn't need to
     review anything.
4. **Clients → Create client → Web application**:
   - Name: `Yielder web`
   - Authorized JavaScript origins: your Cloudflare address from step 1 (e.g.
     `https://yielder-abc.pages.dev`), and `http://localhost:5173` if you also run it locally.
   - No redirect URIs are needed.
5. Copy the **Client ID** (it ends with `.apps.googleusercontent.com`). It isn't a secret: it
   only identifies the app to Google.
6. Back in Cloudflare: your Pages project → **Settings → Variables and secrets → Add**:
   `VITE_GOOGLE_CLIENT_ID` = the Client ID. Then **Deployments → Retry deployment** (or push any
   commit) so the build picks it up.

To use Google sign-in locally too, create a file `.env.local` next to `package.json` with
`VITE_GOOGLE_CLIENT_ID=…` and restart `npm run dev`.

## 3. Move your data in

1. Open your site and click **Continue with Google**. Google asks you to pick your account and
   allow Yielder to "see, edit, create and delete only the specific Google Drive files you use
   with this app". Allow it.
2. The dashboard is empty. Click **Already have data? Open a Yielder file** and choose
   `data\yielder-personal.db` from the project folder. That's a clean copy of everything from
   the old version: your 7 funds and all their months. The old `data\yielder.db` works too.
3. The sidebar shows **Saved to Google Drive**, and a file named `Yielder data.db` appears in
   your Drive. That file is your data from now on.

## 4. Monthly market data

Nothing to do: the repository's GitHub Actions job **Market data** runs on the 20th–25th of
every month, fetches the new month from data.gov.il and commits it when there's something new;
Cloudflare redeploys the site on that commit. You can run it by hand from the repository's
**Actions** tab → **Market data → Run workflow**. If GitHub ever asks, allow Actions for the
repository.

## Good to know

- **Signing in again**: Google sign-ins in the browser last an hour. After that, a reload asks
  you to click **Continue with Google** again, and if it expires while you're working, a banner
  offers **Reconnect** before anything is lost.
- **Two devices**: if the file changed on another device since you opened it, Yielder doesn't
  overwrite it; it asks whether to load the latest version or keep yours.
- **Backups**: Google Drive keeps earlier versions of the file (right-click → **Manage
  versions**), and **Settings → Download a copy** saves the whole file to your computer.
- **Leaving**: your data is a normal SQLite file. You can open it with any SQLite tool, or
  export everything to Excel from **Import → Export my data**.
