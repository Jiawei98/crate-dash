# Deploying Crate Dash to Railway (so students can play via a link)

This turns your local `node server.js` setup into a public URL, using
[Railway](https://railway.com). Total time: ~10-15 minutes, no coding needed
beyond what's already done.

## What you need
- The 4 files in this folder: `server.js`, `crate-dash-3d.html`, `package.json`, `.gitignore`
- A GitHub account (free) — Railway deploys from a GitHub repo
- A Railway account (free to sign up; you'll add a card only if you go past the trial credit)

## Step 1 — Put the files on GitHub
1. Go to [github.com/new](https://github.com/new), create a new **private** repository, e.g. `crate-dash`.
2. On the new repo's page, click **"uploading an existing file"** and drag in:
   `server.js`, `crate-dash-3d.html`, `package.json`, `.gitignore`
   (Don't upload the `data/` folder — the server creates it automatically.)
3. Commit the files.

*(If you're comfortable with git/terminal, this is just `git init`, `git add .`, `git commit`, `git push` to a new repo — same result.)*

## Step 2 — Create the Railway project
1. Go to [railway.com](https://railway.com) and sign in with GitHub.
2. Click **New Project → Deploy from GitHub repo** → select your `crate-dash` repo.
3. Railway detects it's a Node app (from `package.json`) and deploys automatically.
   Wait for the build/deploy to finish (usually under a minute — there are no dependencies to install).

## Step 3 — Add persistent storage (important!)
Without this step, your collected data would be wiped every time you redeploy.

1. In your Railway project, click your service, then the **"Volumes"** tab (or **"+ New" → "Volume"**).
2. Create a volume and set its **mount path** to: `/app/data`
3. In the service's **"Variables"** tab, add: `DATA_DIR` = `/app/data`
4. Redeploy (Railway usually does this automatically after a variable change).

## Step 4 — Get your public link
1. Go to the service's **"Settings" → "Networking"** tab.
2. Click **"Generate Domain"**. Railway gives you a URL like:
   `https://crate-dash-production.up.railway.app`
3. Share that link with students. That's the game.
4. Your dashboard is the same link + `/dashboard`, e.g.
   `https://crate-dash-production.up.railway.app/dashboard`
   (Keep that one for yourself — don't share it with students.)

## Verifying it works
- Open the main link — the game should load and be playable.
- Play one round, then open `/dashboard` — your run should appear.
- Redeploy the service once (e.g. push a small change) and confirm the run is
  *still* in `/dashboard` afterward — this confirms the volume is persisting data correctly.

## Updating the game later
Whenever you want to push changes (e.g. a new feature I help you build):
1. Update the files in your GitHub repo (upload the new version, or `git push`).
2. Railway auto-redeploys. Data in the volume is untouched by redeploys.

## Getting the data back out
- Raw data any time: visit `https://your-link/api/events` (returns JSON).
- Or: on Railway, open a **Shell** for your service (in the service view) and
  `cat data/events.jsonl` to see the raw file, or download it via Railway's
  volume browser if available on your plan.
- To turn it into Excel/CSV, load the JSON into R (`jsonlite::fromJSON`) or
  Python (`pandas.read_json`) and export from there — happy to help write
  that script when you're ready to analyze it.

## Cost
Railway gives new accounts trial credit; after that, a small always-on
service like this typically runs a few dollars a month. If cost matters, let
me know and I can walk you through the Fly.io free-tier alternative instead
— same files, different deploy steps.
