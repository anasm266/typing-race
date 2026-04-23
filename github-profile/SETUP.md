# How to use this on GitHub

The profile `README` is **not** the typing-race repo. It’s a **special repository** that GitHub shows on your profile page.

## Steps

1. **Create a new repository** on GitHub:
   - Name: **exactly your username** (e.g. `anasm266`)
   - Visibility: **Public**
   - Do **not** add a license or .gitignore *unless* you want them; you can start empty.

2. **Clone it** (replace `anasm266` with your username if different):

   ```bash
   git clone https://github.com/anasm266/anasm266.git
   cd anasm266
   ```

3. **Copy** the `README.md` from this `github-profile` folder into the repo **root** (replace any default README).

4. **Edit** that `README.md`: fix your name, add your **LinkedIn URL** in the last line, remove the “open to internships” line if you prefer, and uncomment optional stats/banner if you add assets.

5. **Push:**

   ```bash
   git add README.md
   git commit -m "Add profile README"
   git push origin main
   ```

6. On your **GitHub profile** (`github.com/username`), the README should appear **above** your pinned repositories.

## If the repo name is wrong

The repo name **must** match your username exactly (case matches GitHub’s canonical username on the URL). Check **Settings → Account** for the exact name.

## Optional profile bio

Edit your profile bio in **Settings → Public profile** (or click **Edit profile** on your profile page). Suggested one-liner you can adapt:

> Building real-time web apps. typing_race — share a link, race a friend. TypeScript · Cloudflare · WebSockets.

This file (`SETUP.md`) is only instructions—you don’t have to put it in the public `anasm266` repo unless you want to.
