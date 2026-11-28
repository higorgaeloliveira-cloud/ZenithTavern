# Roster

Characters that ZenithTavern offers in the Roster-Downloader. The entire roster is bundled with ZenithTavern; no Cloudflare or remote storage is used.
Nothing here is loaded automatically: the player picks characters in the Roster-Downloader and only those are copied to the Character List.

Add a character from its exported PNG card:

    node tools/roster-add.cjs "Kinji.png" --sprites ./kinji-expressions --tagline "Quiet, sharp-tongued" --tags campus,slow-burn

`roster.json` lists the characters; each lives in its own folder (`card.png`, `sprites/`). Every character must be an adult (18+).
Each roster file is shipped directly with the ZenithTavern bundle. `roster-add.cjs` writes the required sha256 values into `roster.json` for local integrity checks.
