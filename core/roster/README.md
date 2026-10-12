# Roster

Characters that ZenithTavern offers in the Roster-Downloader. Nothing here is loaded automatically:
the player picks characters in the Roster-Downloader (cloud icon) and only those are copied to the Character List.

Add a character from its exported PNG card:

    node tools/roster-add.cjs "Kinji.png" --sprites ./kinji-expressions --tagline "Quiet, sharp-tongued" --tags campus,slow-burn

`roster.json` lists the characters; each lives in its own folder (`card.png`, `sprites/`). Every character must be an adult (18+).
To host the roster on the web instead, publish this folder and set `"roster": { "remote": "https://.../roster" }` in tavern.config.json (each file then needs its sha256, which roster-add writes for you).
