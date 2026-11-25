# Everyfold privacy policy

_Last updated: 2026-11-25_

Everyfold is a browser extension plus a server that **you deploy to your own Cloudflare account**. There is no Everyfold company service in between: the developer of Everyfold does not run a server for you, has no account system, and receives none of your data.

## What the extension handles

| Data | Why | Where it goes |
|---|---|---|
| Your browser bookmarks (titles, URLs, folder structure) | To sync them between your browsers and sort them into categories | Only to **the server URL you enter** in the extension (your own Cloudflare Worker) |
| Server URL, device name, device token | To talk to your server | Stored locally in the extension (`storage.local`) |
| Admin token | Used once to register the browser | Sent to your server once; **not stored** |
| Sync state (last revision, mapping between browser and server ids, settings) | To sync incrementally | Stored locally in the extension |

The extension does **not** collect analytics or telemetry, does not use cookies or ads, does not read the pages you visit or your browsing history, and does not send anything to the developer or to any third party.

In the Chrome Web Store data-use form, bookmark titles and URLs are declared under *Web history*, the closest listed category (there is no "bookmarks" category). The extension still does not read your browsing history.

## What your server stores

Your server (a Cloudflare Worker with a D1 database in **your** Cloudflare account) stores your bookmark library, its change history, daily snapshots, the registered devices (name, a hash of each device token, last-seen time), and category suggestions. You control it completely: you can read, export or delete it in the Cloudflare dashboard, and deleting the Worker and its D1 database removes everything. Cloudflare processes this data as your hosting provider under [Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/).

## Optional: LLM categorizing (Anthropic)

If — and only if — **you** set an `ANTHROPIC_API_KEY` on your server, the server sends the **title and URL** of bookmarks that its rules could not place, together with your category names, to Anthropic's API (Claude) to pick a category. This happens from your server with your own API key; the extension never talks to Anthropic. Anthropic handles that data under [Anthropic's privacy policy](https://www.anthropic.com/legal/privacy) and the terms of your API account. Without the key, nothing leaves your server.

## Limited use

The use of information received from browser APIs adheres to the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including the Limited Use requirements: bookmark data is used only to provide the bookmark sync and organizing feature, is transferred only to the server the user configured, and is never sold or used for advertising.

## Contact

Questions or concerns: open an issue at <https://github.com/xero0429/everyfold/issues>.
