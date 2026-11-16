# Daybook

Your own reading app. It collects blogs, news sites, newsletters, YouTube
channels and podcasts into one quiet list, grouped by day, with a clean
reading view. It installs to your phone's home screen and keeps the last
collection for reading without signal.

GitHub hosts it for free and collects your sources every hour.

## Set up (about 15 minutes, once)

1. Create a free account at github.com, then a new **public** repository
   called `daybook`.
2. Put everything in this folder into the repository, keeping the folder
   layout (including the hidden `.github` folder).
3. In the repository, open **Settings → Pages** and set **Source** to
   **GitHub Actions**.
4. Open the **Actions** tab. The "Refresh Daybook" run should go green in a
   minute or two. If it has not started, open it and tap **Run workflow**.
5. Your app is at `https://YOUR-USERNAME.github.io/daybook/`.
6. On your phone, open that address, then **Share → Add to Home Screen**
   (iPhone, in Safari) or **⋮ → Install app** (Android, in Chrome).

## Add or remove sources

Edit `feeds.json`. Each source is one line:

    { "name": "Dezeen", "url": "https://www.dezeen.com/feed/" },

- **Blogs and news sites:** the site's address is usually enough; Daybook
  finds the feed. If it cannot, use the site's RSS address.
- **YouTube:** paste the channel address, for example
  `https://www.youtube.com/@channelname`.
- **Podcasts:** use the podcast's RSS address (most podcast sites list it).
- **Newsletters:** go to kill-the-newsletter.com, create a feed, and it
  gives you an email address and a feed address. Subscribe to the newsletter
  with that email address, and add the feed address here with
  `"kind": "newsletter"`. Some publishers block that address; forwarding the
  newsletter from your own inbox to it works as a fallback.

The three sources already in `feeds.json` are starters. Swap them for your
own. The **Sources** screen in the app shows which ones were reached last
time and why any failed.

## Good to know

- **Saved items and read marks live on the phone**, not in GitHub. They do
  not follow you to another device, and clearing the browser's data
  removes them.
- **Some sites publish only a short excerpt** in their feed. Daybook shows
  what the site provides, with a button to open the original.
- **Your list of sources is public**, because free GitHub hosting needs a
  public repository. The app address is not advertised anywhere, but anyone
  who has it can open it.
- **GitHub pauses the hourly collection after 60 days with no changes to
  the repository.** It emails you first; one tap on "Enable workflow" in
  the Actions tab resumes it.
- The hourly run can start a few minutes late when GitHub is busy.

## Change how it looks

Everything visual is in `site/index.html`. The colours and fonts are the
named values at the top of the `<style>` block.

## Run it on a computer

    npm install
    npm run build
    npx serve site
