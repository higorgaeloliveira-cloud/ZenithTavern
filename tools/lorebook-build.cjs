#!/usr/bin/env node
'use strict';
/*
 * Builds the two cast lorebooks from the character sources.
 *   node tools/lorebook-build.cjs
 * Reads  core/roster/source/<id>/character.json  (+ core/roster/source/_subbots-extra.json)
 * Writes core/worlds/Characters.zenith-world.json   everything the model needs about each character (one entry per character)
 *        core/worlds/Sub-bots.zenith-world.json     short cast cards keyed by PLACE, plus the multi-character rules
 * The "!Name" command reads these two lorebooks: Characters first, then Sub-bots.
 * Run it again (and then build) after changing any character.json.
 */
const fs = require('fs');
const path = require('path');
const { describe } = require('./character-text.cjs');

const SRC = path.join(__dirname, '..', 'core', 'roster', 'source');
const OUT = path.join(__dirname, '..', 'core', 'worlds');
const first = (n) => n.split(/\s+/)[0];
const NO_FIRST_KEY = new Set(['June']); // a plain month name would trigger by accident

const recs = fs.readdirSync(SRC).filter((d) => fs.existsSync(path.join(SRC, d, 'character.json')))
  .map((d) => JSON.parse(fs.readFileSync(path.join(SRC, d, 'character.json'), 'utf8')));

const chars = recs.map((r, i) => {
  const { description } = describe(r);
  const keys = [r.name, ...(NO_FIRST_KEY.has(first(r.name)) ? [r.name.split(/\s+/).slice(-1)[0]] : [first(r.name)]), ...(r.lore_keys || [])];
  return {
    id: `char_${r.id}`, name: r.name, category: 'characters',
    activation: { mode: 'keywords', priority: 60 - i },
    keys: [...new Set(keys)],
    character_filter: [r.name],   // not repeated inside the character's own chat
    prevent_recursion: true,
    content: `[CHARACTER: ${r.name}]\n${description.trim()}`,
  };
});

const RULES = `[SUB-BOTS: MORE THAN ONE CHARACTER IN A SCENE]
Asterhaven is full of named residents who work, live and study in set places. Whenever the scene is at a place where one of them works or lives (a SUB-BOT entry for that person appears below), at a plausible hour, that person is there and takes part, and you play them IN THE SAME REPLY as {{char}}.
- One reply, one header: keep the single ¦¦ header. Do not write a second header or a second reply.
- Everyone present gets their own voice, body language and (for demi-humans) ears and tail reacting to the moment. In every paragraph make it clear in its first sentence who is speaking or acting.
- {{char}} stays the lead. A resident meeting {{user}} or {{char}} for the first time is a stranger to them; do not invent shared history, friendship or romance that the chat has not established.
- Respect schedules and places: do not bring a resident somewhere they plausibly would not be. If an entry shows up but the time clearly does not fit, leave that person out.
- Never write {{user}}'s words, actions, thoughts or feelings.
- FORCED GUESTS: if a SCENE GUEST instruction says {{user}} called a character into the scene, that character enters in this reply. Choose a natural reason (a customer, an errand, looking for someone) unless the instruction says how. A guest stays in the scene until it is natural for them to leave.
- All response-format and paragraph rules still apply to the whole reply.`;

const bots = [{ id: 'subbot_rules', name: 'Sub-bot rules', category: 'rules', activation: { mode: 'always' }, keys: [], content: RULES, prevent_recursion: true }];
const mkBot = (name, b, i, filter) => ({
  id: `subbot_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, name, category: 'sub-bots',
  activation: { mode: 'keywords', priority: 50 - i },
  keys: b.keys, character_filter: filter ? [name] : [], prevent_recursion: true,
  content: `[SUB-BOT: ${name}]\n${b.card}\nFound at: ${b.places}. Usual hours: ${b.when}.\nIf the scene is at one of these places at a plausible time, ${first(name)} is there and takes part, played in the same reply as {{char}} with their own voice. Full profile: Characters lorebook.`,
});
let n = 0;
for (const r of recs) if (r.sub_bot) bots.push(mkBot(r.name, r.sub_bot, n++, true));
const extraFile = path.join(SRC, '_subbots-extra.json');
if (fs.existsSync(extraFile)) for (const e of JSON.parse(fs.readFileSync(extraFile, 'utf8'))) bots.push(mkBot(e.name, e, n++, false));

const world = (name, description, entries) => ({ schema_version: '1.0', project: 'ZenithTavern', world: { name, description, managed: true }, entries });
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'Characters.zenith-world.json'), JSON.stringify(world('Characters', 'Full profiles of the cast. Used by the !Name command and when a character is mentioned.', chars), null, 2));
fs.writeFileSync(path.join(OUT, 'Sub-bots.zenith-world.json'), JSON.stringify(world('Sub-bots', 'Short cast cards keyed by place, plus the multi-character rules. Used by !Name and by places in the story.', bots), null, 2));
console.log(`Characters: ${chars.length} entries; Sub-bots: ${bots.length} entries`);
