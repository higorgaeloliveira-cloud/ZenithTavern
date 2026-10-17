'use strict';
/*
 * World Info installer.
 *
 * Put lorebooks in  core/worlds/  (managed)  or  overlay/worlds/  (yours). Two kinds of file work:
 *   *.zenith-world.json  the portable ZenithTavern format (schema_version, world, entries[]) - converted here
 *   *.json               an ordinary SillyTavern World Info export - copied as it is
 * Each one is installed into your SillyTavern "worlds" folder ONLY IF a lorebook with that name is not
 * there yet, so anything you edit inside SillyTavern is never overwritten.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const hashOf = (entries) => crypto.createHash('sha1').update(JSON.stringify(entries)).digest('hex');

/** Portable ZenithTavern world -> SillyTavern World Info file. */
function convert(src) {
  const entries = {};
  let uid = 0;
  const base = (over) => ({
    uid, key: [], keysecondary: [], comment: '', content: '', constant: false, vectorized: false, selective: true,
    selectiveLogic: 0, addMemo: true, order: 100, position: 0, disable: false, ignoreBudget: false,
    excludeRecursion: false, preventRecursion: false, matchPersonaDescription: false, matchCharacterDescription: false,
    matchCharacterPersonality: false, matchCharacterDepthPrompt: false, matchScenario: false, matchCreatorNotes: false,
    delayUntilRecursion: 0, probability: 100, useProbability: true, depth: 4, outletName: '', group: '', groupOverride: false,
    groupWeight: 100, scanDepth: null, caseSensitive: false, matchWholeWords: true, useGroupScoring: null, automationId: '',
    role: 0, sticky: null, cooldown: null, delay: null, displayIndex: uid, characterFilter: { isExclude: false, names: [], tags: [] },
    triggers: [], ...over,
  });

  // Entries that are always on come first (highest order), then keyword entries by their priority.
  const list = [...(src.entries || [])];
  const always = list.filter((e) => e.activation?.mode === 'always');
  for (const e of list) {
    const isAlways = e.activation?.mode === 'always';
    entries[uid] = base({
      comment: e.name, // SillyTavern has no categories; the category is kept in the portable file
      content: e.content || '',
      constant: isAlways,
      key: isAlways ? [] : [...(e.keys || [])],
      order: isAlways ? 100 - always.indexOf(e) * 5 : Number(e.activation?.priority ?? 50),
      ...(e.character_filter?.length ? { characterFilter: { isExclude: true, names: [...e.character_filter], tags: [] } } : {}),
      ...(e.prevent_recursion ? { preventRecursion: true, excludeRecursion: true } : {}),
    });
    uid++;
  }
  if (Array.isArray(src.design_notes) && src.design_notes.length) {
    entries[uid] = base({
      comment: 'Design notes (switched off, never sent to the AI)',
      content: src.design_notes.map((n) => `- ${n}`).join('\n'),
      disable: true, order: 0,
    });
  }
  return { name: src.world?.name || 'World', entries, managed: !!src.world?.managed };
}

/** Install every lorebook found in the worlds folders. Returns the names that were added. */
function installWorlds({ roots, destDir }) {
  const added = [];
  fs.mkdirSync(destDir, { recursive: true });
  for (const dir of roots) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      let data;
      try { data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')); } catch { continue; }
      let name;
      let out;
      if (file.endsWith('.zenith-world.json') || data.schema_version) {
        const c = convert(data); name = c.name; out = { entries: c.entries };
        if (c.managed) out.zenith_hash = hashOf(out.entries);
      } else if (data.entries) {
        name = file.replace(/\.json$/i, ''); out = data;
      } else continue;
      const safe = name.replace(/[\\/:*?"<>|]/g, '').trim();
      if (!safe) continue;
      const dest = path.join(destDir, `${safe}.json`);
      if (fs.existsSync(dest)) {
        // A managed lorebook (the cast) is refreshed when a newer version ships, but only if the installed copy was never edited.
        if (!out.zenith_hash) continue;
        let old; try { old = JSON.parse(fs.readFileSync(dest, 'utf8')); } catch { continue; }
        if (!old.zenith_hash || old.zenith_hash === out.zenith_hash || hashOf(old.entries) !== old.zenith_hash) continue;
        fs.writeFileSync(dest, JSON.stringify(out, null, 2));
        added.push(`${safe} (updated)`);
        continue;
      }
      fs.writeFileSync(dest, JSON.stringify(out, null, 2));
      added.push(safe);
    }
  }
  return added;
}

module.exports = { convert, installWorlds };
