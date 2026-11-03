# Gift Exchange

A private gift exchange website. You add everyone and each person gets their own private link, where they add their gift list. When you draw names, nobody can get themselves. Each person's link then shows who they're buying for, that person's gift list, and your guidelines. At the end, you reveal who had who.

Only people you send a link to can get in. You never see who drew whom until you reveal it, so you can take part too.

## Put it online (free, about 5 minutes)

You need your GitHub and Vercel accounts.

1. **Make a GitHub repository.** Unzip the download first. On github.com, click **New repository**, name it something like `gift-exchange`, choose **Private**, and click **Create repository**. On the empty repo page, click **uploading an existing file**. Drag in everything inside this folder (the `api`, `lib`, `public`, `dev` and `test` folders plus the files next to them), then click **Commit changes**.
2. **Import it into Vercel.** On vercel.com, click **Add New** > **Project**, pick the repository, leave every setting as it is, and click **Deploy**.
3. **Add the free database.** In the new project, open the **Storage** tab and click **Create Database**. Choose **Upstash for Redis**, pick the **Free** plan (any US East region is fine), and connect it to this project.
4. **Redeploy** so the site can use the database. Open the **Deployments** tab, open the menu on the newest deployment, and click **Redeploy**.
5. **Set your organizer password right away.** Open `https://<your-project>.vercel.app/admin`. The first person to open that page sets the password, so do it before sharing anything.

If you'd rather use the command line: run `npx vercel` in this folder (sign in and accept the defaults), add the database as in step 3, then run `npx vercel --prod`.

## Running the exchange

1. On `/admin`, add everyone, including yourself if you're taking part.
2. Use **Copy link** (or **Send** on your phone) to text each person their private link. They add their gift list there. You can also add lists for people with **Edit**.
3. Optional: under **Keep apart**, pair people who shouldn't draw each other, like couples.
4. Click **Draw names**. Then tell everyone to open their link again. They tap their slip to see who they got.
5. After all the gifts are opened, click **Reveal who had who**. Everyone's link then shows the full list.

### Good to know

- **Change the guidelines or the exchange name** under **Exchange details** on `/admin`. The four guidelines you gave are already filled in.
- **A link went to the wrong person?** Open **Edit** for that person and click **Make a new link**. The old link stops working.
- **Adding or removing someone after the draw:** click **Undo draw**, make the change, and draw again. Everyone's match will change, so let them know.
- **Don't open other people's links.** Tapping someone's slip shows you who they got and marks it as opened.
- **Forgot the organizer password?** In Vercel, open **Storage**, open the database in Upstash, and go to the **Data Browser**. Delete the key `gx:admin`, then open `/admin` to set a new password. Nothing else is affected.
- **Next year:** click **Undo draw**, update the people and lists, and draw again. Everyone keeps the same link.

## Running it on your computer

Run `npm run dev` and open http://localhost:3000/admin. It uses a temporary in-memory database that's cleared when you stop it. Run `npm test` to run the checks. Neither needs any packages installed.

## How it's built

- `public/` has the pages: `index.html` is each person's page (their link is `/#<private-code>`), and `admin.html` is the organizer page.
- `api/exchange.js` is the only server endpoint. The logic lives in `lib/`, and the draw is in `lib/draw.js`.
- Data is kept in a few Upstash Redis keys that start with `gx:`. Nothing else is stored anywhere.
- The fonts are Atkinson Hyperlegible Next and Caveat, both under the SIL Open Font License. Their license files are in `public/fonts/`.
