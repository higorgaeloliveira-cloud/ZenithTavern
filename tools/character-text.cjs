'use strict';
/* Shared by character-build.cjs (the card) and lorebook-build.cjs (the Characters lorebook): turns a character.json record into the description text. */
function describe(rec) {
const list = (a) => (Array.isArray(a) ? a.filter(Boolean) : []);
const bullets = (a) => list(a).map((x) => `- ${x}`).join('\n');
const section = (title, body) => (body && String(body).trim() ? `${title}:\n${String(body).trim()}\n` : '');

const id = rec.identity || {}, ap = rec.appearance || {}, pe = rec.personality || {}, bg = rec.background || {}, wp = rec.world_placement || {}, so = rec.social_profile || {};
const place = [
  wp.residence && `Lives: ${wp.residence.type || 'home'}, ${wp.residence.district || ''}. Roommates: ${wp.residence.roommates || 'not set'}.`,
  wp.employment && `Works: ${wp.employment.role || ''} at ${wp.employment.workplace || ''} (${wp.employment.workplace_type || ''}), ${wp.employment.district || ''}.`,
  wp.university && `Studies: ${wp.university.major || ''}, year ${wp.university.year || ''}, ${wp.university.institution || ''}.`,
  list(wp.regular_locations).length && `Regular places:\n${list(wp.regular_locations).map((l) => `- ${l.location}: ${l.reason}`).join('\n')}`,
].filter(Boolean).join('\n');

const description = [
  `{{char}} is ${rec.name}, a ${id.age}-year-old ${id.species || 'human'} (${list(id.pronouns).join(', ')}). ${id.academic_status ? `${id.academic_status[0].toUpperCase()}${id.academic_status.slice(1)}, ${id.major}, year ${id.year}, ${id.university}.` : ''}`,
  section('APPEARANCE', [`Height: ${ap.height}`, `Build: ${ap.build}`, `Hair: ${ap.hair}`, `Eyes: ${ap.eyes}`, `Style: ${ap.style}`, ...list(ap.distinguishing_details)].filter((x) => !/undefined/.test(x)).join('\n')),
  section('PERSONALITY (what others see)', bullets(pe.public_traits)),
  section('PERSONALITY (underneath)', bullets(pe.private_traits)),
  section('HOW {{char}} SPEAKS', pe.communication_style),
  section('STRENGTHS', bullets(pe.strengths)),
  section('FLAWS', bullets(pe.flaws)),
  section('BOUNDARIES', bullets(pe.boundaries)),
  section('BACKGROUND', [bg.summary, bg.family && `Family: ${bg.family}`, list(bg.important_history).length && `History:\n${bullets(bg.important_history)}`].filter(Boolean).join('\n')),
  section('WANTS', bullets(rec.motivations)),
  section('HABITS AND INTERESTS', bullets(rec.habits_and_interests)),
  section('PLACE IN THE WORLD', place),
  section('SOCIAL BEHAVIOUR', [so.social_behavior, so.relationship_notes].filter(Boolean).join('\n')),
  section('CONTINUITY RULES (always follow)', bullets([...list(rec.encounter_rules), ...(list(rec.continuity?.unset_details).length ? [`Details that are still unset (leave them unset, do not present guesses as canon): ${list(rec.continuity.unset_details).join('; ')}.`] : [])])),
].filter(Boolean).join('\n');
  return { description, list };
}
module.exports = { describe };
