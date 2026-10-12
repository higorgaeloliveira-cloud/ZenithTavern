# ZenithTavern

A customizable SillyTavern setup. It downloads the **unmodified** official SillyTavern, then adds
*your* extensions, server plugins and settings on top. Because you never edit SillyTavern's own
files, you can update SillyTavern any time without breaking your changes.

## What you need (once)
- **Node.js 20 or newer** (the "LTS" download): https://nodejs.org
- **Git**: https://git-scm.com/downloads

## Install: put the launcher in any folder
Copy `ZenithTavern.cjs` (and the `Start-panel` / `Start-console` files) into the folder where you want ZenithTavern, then start it.
**Everything installs into that same folder**, wherever it is:
- files in `C:\Downloads` → installed in `C:\Downloads`
- files in `D:\Downloads\sillytavern` → installed in `D:\Downloads\sillytavern`

The first run unpacks the project (`src/`, `overlay/`, `tavern.config.json`, ...) next to the launcher,
so pick a folder you're happy to have that in (a fresh empty folder is tidiest). To move it later, move
the whole folder.
`src/` and `tools/` are managed by the launcher; `overlay/` and `tavern.config.json` are yours and are never overwritten.
To make your own one-file launcher after customizing: `node tools/build.cjs` (creates `dist/`).

## Run it

**Two ways to run it.** In the full project folder, double-click `Start-panel.bat` (it runs the code in `src/`). Or use the single-file launcher from the `dist/` folder: `ZenithTavern.cjs` with its Start and Repair files, which work in any folder you put them in.

| | Windows | Mac / Linux |
|---|---|---|
| Start, clean screen | double-click `Start-panel.bat` | `./Start-panel.sh` |
| Start, shows every step | double-click `Start-console.bat` | `./Start-console.sh` |
| Fix problems | double-click `Repair.bat` | `./Repair.sh` |

The first start downloads SillyTavern and installs its packages (a few minutes). After that it
starts in seconds. Your browser opens at http://localhost:8000. Keep the black window open; close
it (or press Enter in it) to stop.

**Panel vs Console.** Both start exactly the same ZenithTavern; only the black window looks different.
- *Panel*: big logo, version, detected device, update check and the "keep this window open" notice. Nothing else.
- *Console*: the same, plus every command that runs (`git`, `npm`), every download, every file written, and the live server output.

Panel hides the noise, it doesn't throw it away: it is saved in `logs/launcher.log`, and shown on screen if a step fails.
Running `node ZenithTavern.cjs` with no choice gives the panel; add `--console` for the other one.

Self-check (starts, tests that your extension and plugin loaded, stops):
`node src/launcher.cjs --smoke-test`

## What's in the folder
```
ZenithTavern/
├─ Start-panel.bat / .sh         launch (clean screen)
├─ Start-console.bat / .sh       launch (shows every step)
├─ Repair.bat / Repair.sh        wipe + re-download SillyTavern (your data is backed up first)
├─ tavern.config.json            ★ your settings: name, port, SillyTavern version, updates
├─ core/                         launcher-managed features (welcome popup, branding, system routes) - refreshed on updates, don't edit
├─ overlay/                      ★ YOUR FILES - this is where you work
│  ├─ extensions/mytavern-core/  browser-side feature (UI, commands, prompt changes)
│  └─ plugins/mytavern-server/   server-side feature (files, secret keys, other websites)
├─ src/                          the launcher code (you rarely need to touch this)
├─ SillyTavern/                  downloaded automatically - DON'T edit, it's replaced on update/repair
├─ userdata/                     your chats, characters, settings (safe from Repair)
├─ config/config.yaml            SillyTavern's settings file
├─ logs/server.log               look here when something breaks
└─ backups/                      automatic copies made by Repair
```
`overlay/` is copied into SillyTavern each time you start, so edit your files there, then
restart. (Press Ctrl+F5 in the browser to reload extension changes.)

## tavern.config.json
| Setting | Meaning |
|---|---|
| `name` | Name shown in the launcher |
| `port` | Web port (default 8000) |
| `listen` | `false` = only this computer; `true` = other devices on your network can connect. Turning this on exposes your chats: set up SillyTavern's login/whitelist first |
| `openBrowser` | Open the browser on start |
| `upstream.ref` | `"release"` = stable SillyTavern. Put a version like `"1.19.0"` to pin it and never change |
| `upstream.updates` | `"ask"` (default), `"auto"`, or `"never"` |
| `stConfig` | Extra SillyTavern `config.yaml` values to force, e.g. `"extensions.autoUpdate": false` |

## Making it yours: where each idea goes
| You want to… | Do this |
|---|---|
| Add a settings panel, button or `/command` | Edit `overlay/extensions/mytavern-core/` (`index.js` is commented as a tutorial) |
| Change what the AI is told | The interceptor in `index.js` (shows `setExtensionPrompt`) |
| Change colors/look | `overlay/extensions/mytavern-core/style.css` |
| Save files, hide an API key, call another website | `overlay/plugins/mytavern-server/index.mjs`, call it from the extension with `fetch('/api/plugins/mytavern-server/...')` |
| Add a second feature | Copy the `mytavern-core` folder to `overlay/extensions/my-second-feature/`, change `display_name`, the settings key, and the paths in `index.js` |
| Ship characters / lorebooks / presets as defaults | Put them in `overlay/` and add a copy step in `syncOverlay()` in `src/lib.cjs` (ask Claude to add it) |

## The streamlined interface (what is hidden, and how to get it back)

ZenithTavern hides the settings people tend to break. The top bar is now: **Settings** (gear), **World Info**, **Home** (leaves the current chat), **User Persona**, **Character List**.

- Hidden: AI Response Configuration, AI Response Formatting, User Settings, Change Background Image, and the separate Extensions button.
- **Settings** (the gear) is one merged menu: API connection, a few useful interface settings, and the extension panels with "Manage extensions" at the bottom. "Advanced Options" (top right of that menu) shows the API type pickers.
- OpenRouter is pre-selected the first time ZenithTavern starts.
- **Locked response values:** context size, response length and temperature are set from the `presets` block in `tavern.config.json` every time you generate (defaults: 200000 / 1000 / 1). Edit the numbers there, or set `"enforce": false` to stop locking.
- **Creator mode** shows everything again: type `/zenith-dev on` in the chat box. Turn it off with `/zenith-dev off`. This is a convenience switch, not a security lock: anyone who knows it can use it.

Code: `core/extensions/zenith-ui/` (style.css lists everything that is hidden, one selector per line).

## Streaming (Settings)

Streaming is **off by default**: each reply appears whole when it is finished. Turn it on with the *Streaming* switch in Settings (above Network access). The choice is remembered and re-applied before every generation. Creator mode (`/zenith-dev on`) leaves SillyTavern's own streaming checkbox in control.

## Log Terminal (bottom of Settings)

The **Log Terminal** button at the very bottom of Settings opens a view-only window with timestamps:

- **Browser** tab: every console message, warning and error, uncaught errors, the little toast messages that flash at the top of the screen, and failed network requests (plus the generation requests, so you can see them happen). Debug messages are hidden until you tick **Debug**.
- **Server** tab: the live server log (`logs/server.log`). Those lines are stamped when the window receives them.
- Tick or untick Errors / Warnings / Info / Log / Debug, search, **Copy** or **Save .txt** what you see, and **Clear** the view. **Follow** keeps the newest line in sight; scrolling up stops it.
- You can also open it by typing `/logs`. It keeps the last 3000 lines per tab, and it starts recording as soon as the page loads, even before you open it.

## LunaRouter (automatic fallback between models and APIs)

In **Settings**, right under the **Connect** button, press **LunaRouter**. A window opens where you set up:

- **Connections (up to 2):** each one is *OpenRouter* or *LM Studio / local server* (any OpenAI-compatible address, for example `http://127.0.0.1:1234/v1`). Keys are never stored by LunaRouter: it uses the key you saved in Settings for that API. **Load models** lists what each connection offers.
- **Models (up to 4):** pick the connection, type or choose the model name, and choose its **order** (1st, 2nd, 3rd, 4th).
- **Use LunaRouter:** when ON, every reply is tried on the 1st model; if it fails (an error, an error message from the provider, an empty reply, or no answer within the time limit you set), the same request goes to the 2nd, and so on. Pressing Stop never retries. If every model fails you see SillyTavern's normal error.

While it is ON, LunaRouter chooses the model: the one picked in Settings is ignored. It works with Chat Completion. Slash command: `/luna-router on|off|open`. Code: `core/extensions/zenith-router/`.

## Multi-IP: using ZenithTavern from your phone (Tailscale, home network)

In **Settings** (the gear), under "Network access", the **Toggle Multi-IP** switch controls who can connect.

- **Off** (default): only this computer, at `127.0.0.1:8000`.
- **On**: ZenithTavern also listens on the network, and **only the IPs on your list** can connect. Press **+ Add New IP** and type the IP of the device that will connect (for example your phone's Tailscale address, `100.x.x.x`). A single IP or a narrow range like `100.64.0.0/10` works. Entries that would open it to everyone (`0.0.0.0/0`, wildcards, very wide ranges) are refused.
- Changes need a restart: press **Apply & restart** in the same box. The page reloads by itself.
- On the other device, open the address shown in the box, for example `http://100.x.x.x:8000` (this computer's Tailscale address).

Behind the scenes this sets `listen` and the `whitelist` in `config/config.yaml` for you, using the `network` block in `tavern.config.json`. Turning it Off restores the defaults. The first time, Windows may ask to allow Node.js through the firewall: allow it for private networks.

Only add devices you trust. The list is an IP check, not a password.

## Music (the ♪ button, next to Home)

**Spectrum.** While a song plays, a live honey-yellow audio spectrum (real analysis of the sound, not a canned animation) is drawn on the right border of the window. It is the lowest layer of the page: characters, the phone, menus and pop-ups sit on top of it, and it never grows past the left edge of the free space beside the chat box. Turn it on or off with the *Spectrum* switch in the Music panel, or by right-clicking the Music button (a small dot on the button shows it is on). Windows too narrow to have free space on the right show no spectrum.

**Phone button.** The phone button sits in a slim bar above the message box (`#zenith_bar`); future quick buttons go in the same bar.

Create playlists, add your own audio files (mp3, wav, ogg, m4a, flac, opus), and press **Listen to Playlist** to play them in order. You can rename or remove playlists, reorder songs, shuffle, repeat, and the music keeps playing while you change chats or close the panel. The button glows while something plays.

Files are saved in your data folder (`userdata/<user>/zenith-music/`), so they are included in Repair's backups. Playlist names and order are saved with your settings. Code: `core/extensions/zenith-music/` and the `/music` routes in `core/plugins/zenith-system/`.

## The Zenith Panel (now the phone apps)

These features are apps on the Zenith Phone (see above). `/zenith-panel` opens the old side panel with the same four tabs:

- **Modes**: *OOC Mode* pauses the roleplay so you can talk to your narrator out of character. You can edit the instruction it uses.
- **Course Correction**: pick a saved note ("slow the pace", "more dialogue"...) that is slipped into the prompt like feedback from you. *Until changed* keeps it on; *Dose* applies it to a set number of replies, then turns itself off. Add, edit and delete your own presets.
- **Narrators**: choose a narrator whose style is added to every prompt. Type `!Name` (for example `!Sol`) in a message to bring any narrator into the scene for that one reply. The three starter narrators are placeholders: rename them and write your own.
- **Copycat**: rewrites the AI's last message using your note. The *Catnip Jar* stores favourite notes; "Automatically apply" adds a note to every rewrite. It uses the model you are connected to.

Slash commands: `/zenith-ooc on|off|toggle`, `/zenith-narrator Sol`, `/zenith-rewrite make it shorter`.

Code: `core/extensions/zenith-panel/` (managed by the launcher; copy it into `overlay/extensions/` under a new name if you want to change the code yourself).

## World Info (lorebooks that come with ZenithTavern)
Put a lorebook in `core/worlds/` (managed) or `overlay/worlds/` (yours) and the launcher adds it to World Info when it starts:
- `Name.zenith-world.json`: the portable ZenithTavern format (like `Asterhaven.zenith-world.json`). It is converted for you: "always" entries become always-on entries, keyword entries keep their keys and priority, design notes become one switched-off entry.
- `Name.json`: an ordinary SillyTavern World Info export, copied as it is.
A lorebook is only added if one with that name isn't there yet, so edits you make inside SillyTavern are never overwritten. The starter lorebook **Asterhaven** is switched on for all chats once, the first time; if you switch it off later it stays off.

## Theme: Zenith Gold
ZenithTavern's own look: a warm near-black base with gold and amber accents (text `#ece6d6`, italics soft gold, quotes amber `#ffbe3c`, panels `#16140f`).
- The launcher installs it into SillyTavern's theme list and selects it **once**, the first time. Choose another theme later and it stays that way (`/theme Zenith Gold` brings it back).
- The accent color is one value, `--zenith-accent` (default `#f5c451`), used by the phone, the Zenith panels, the Log Terminal and the launcher screen. To recolor everything, change it in `core/extensions/zenith-ui/style.css` and in the theme's custom CSS.
- Edit the theme inside SillyTavern (User Settings > UI Theme) and save it under a new name. A theme file is never overwritten once it exists.
- Your own themes: put `.json` theme files in `overlay/themes/`.
- New phones start with the "Zenith Gold" wallpaper. If you already picked or kept the old purple one, choose it again in the phone's Settings app.

## Strict characters and the Roster-Downloader

**Strict characters.** This fork only accepts the characters it ships. Importing (file, URL, drag and drop), exporting, duplicating and creating cards are refused by the server itself, and the screen shows a popup saying ZenithTavern does not accept other characters and that normal SillyTavern must be used for those. The Character List only shows cards installed from the roster. Switch it off with `"characters": {"strict": false}` in `tavern.config.json`.

**Locked character panel.** Opening a character shows only her picture, name and the favorite star. The description, greeting, creator's notes, tags, token counts, the "More…" menu and the delete / export / duplicate / advanced-definition buttons are hidden, the picture and name cannot be edited, and bulk edit is hidden. This is a screen lock, not a server lock: creator mode (`/zenith-dev on`) shows everything again.

**Roster-Downloader (cloud icon, between Music and the Character List).** Nothing is loaded automatically. Open the cloud, tick characters, press *Download Selected* or *Download All*; after the download they appear in the Character List together with their expression images. `/roster` opens it too.

**Characters in the roster so far:** Mara Venn (001), without expression images yet. Her source files live in `core/roster/source/mara-venn/` (`character.json`, `portrait.png`, `images/greeting.png`; drop expression PNGs in a `sprites/` folder there).

**Adding or updating a character from its portable record (recommended):** `node tools/character-build.cjs core/roster/source/<name>` builds the card (V2 + V3, with the description made from the record) and puts it in the roster. Run it again when sprites or text change: the version goes up and players see *Update available*. Images listed under `images/` are installed to the player's own images folder and can be used inside messages, as Mara's greeting picture is.

Adding characters from a finished card (creator side): `node tools/roster-add.cjs "Name.png" --sprites ./expressions --tagline "..."` (cards are normal SillyTavern PNG cards, put in `core/roster/`). To host the roster online, publish that folder and set `"roster": {"remote": "https://.../roster"}`; every file is then checked against its sha256. **Every roster character must be a clear adult (18+).**

## Model profile, response format and modes (PromptOS app)

**Adaptive context.** The context size and the reply length follow the selected model: the model name decides a comfortable window (for example Gemma 4 31B: large, 200,000+; weaker Gemma or small Qwen models: medium, small or tiny), the API-reported context is used when it is lower, and with LunaRouter on the smallest model of the route list counts. Thinking models get extra room for their reasoning. Tiers: Large (5-6 paragraphs), Medium (4-5), Small (3-4), Tiny (3). Override the tier in PromptOS; `/zenith-model` shows the numbers. `tavern.config.json` `presets.maxContext` is only the ceiling, and `"adaptive": false` there brings the fixed numbers back.

**Format.** Every reply starts with `¦¦ Monday, Aug 24th ~ 2:26 PM ~ Place ~ (SAPH) ¦¦`, then 3 to 5/6 descriptive paragraphs. The previous header is read back so date and time continue. Skipped in OOC.

**Paragraph rule.** Every paragraph is one solid block of at least 5 full descriptive sentences. One-line paragraphs, a line break after every sentence and staccato fragments ("She froze. She looked around.") are forbidden in the prompt. If the last reply was chopped into short pieces anyway, the next prompt carries a correction.

**Modes.** OPAL (story mode: slow, reluctant, in-pieces storytelling), SAPH (everyday romance), ONYX (intense romance), RUBY (graphic adult content). In Auto the AI picks the mode and climbs one step per reply; `/zenith-mode auto|opal|saph|onyx|ruby` locks it. Each mode has its own editable prompt in PromptOS and can be switched off. The prompts are original text. Romance and sex are only written for clearly adult characters; that rule is built in.

## Zenith Phone (the phone button above the message box)
A phone (iPhone 11 layout) slides up on the right side of the screen. Click the phone button (bottom right, above the message box), or type `/phone`.
- It starts **locked**. Click the **home bar** at the bottom to unlock it. Click the home bar again inside an app to go back to the home screen.
- The **side button** (right edge of the phone) locks it. Closing the phone locks it too. It shrinks to fit small windows.
- A small green dot on an app icon means that feature is switched on right now.

Apps (the old ✦ Zenith Panel now lives in here; `/zenith-panel` still opens the old side panel):
| App | What it does |
|---|---|
| Course Modifiers | Course Correction presets: slip a note into the AI's prompt, until you change it or for N replies |
| Narrators | Narrator styles; type `!Name` in a message to summon one for a reply |
| Copycat | Rewrite the AI's last message with your note; the Catnip Jar holds saved notes |
| OOC | OOC Mode: pause the roleplay and talk to your narrator |
| Settings (in the dock) | Wallpaper (8 presets, any color, or your own picture) and dimming, 12h/24h clock, app names on/off, real battery level, phone color (6), size, left/right side, keep unlocked, reset |
| System Prompts | placeholder ("Coming soon") until the characters and expressions exist |

To add an app, add an entry to the `APPS` list at the top of `core/extensions/zenith-phone/index.js`.

## Branding ("ZenithTavern" instead of "SillyTavern")
`core/extensions/zenith-branding/` swaps the name in menus, popups and the tab title. It leaves the chat itself,
links that point to SillyTavern, and the credit line alone. The version line reads
`ZenithTavern (SillyTavern 1.x.x ...)` so you always know which engine version you run. Not renamed on purpose:
the `SillyTavern/` folder, config keys and internal ids (changing those would break updates), the login page
(when accounts are enabled), and the logo image (supply your own file to replace it).
Credit to SillyTavern must stay (AGPL-3.0); the welcome popup includes it.

## The first-run welcome popup
Customized by `core/extensions/zenith-welcome/` (title, removed characters block, risk notice with Yes/No).
Edit the texts at the top of its `index.js`. "No" asks the server plugin (`zenith-system` plugin, `/decline` route) to stop
with exit code 42; the launcher treats that as "declined" and closes quietly. Declining is not remembered,
so the question returns on the next start; "Yes" is remembered by SillyTavern's own first-run flag.
To see the popup again after saying Yes, delete `userdata/` (this erases your chats and settings).

## Rules that keep it update-proof
1. **Never edit files in `SillyTavern/`.** Put changes in `overlay/`.
2. If you must change SillyTavern's behavior, prefer an extension or plugin hook over editing core.
3. Keep `userdata/` and `config/` out of git (the `.gitignore` already does).

## If something breaks
1. Read the last lines of `logs/server.log`.
2. Run **Repair**. It backs up `userdata/` and `config/` first.
3. Hard-refresh the browser (Ctrl+F5).

## Licensing (important if you share it)
SillyTavern is **AGPL-3.0**, and extensions/plugins that run inside it should be treated as part of
that work. Publishing yours under AGPL-3.0 (the included `LICENSE`) is the safe default. If you run a
modified version for other people over a network, you must offer them the source.
This project contains no code or content from WeylandTavern; if you later borrow from another fork,
check its license first. Its characters, prompts and setting text are not licensed for reuse.
