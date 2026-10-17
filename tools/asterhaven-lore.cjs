#!/usr/bin/env node
'use strict';
/*
 * The Asterhaven world lorebook. One source, two outputs:
 *   node tools/asterhaven-lore.cjs
 *   -> core/worlds/Asterhaven.zenith-world.json   the lorebook (installed by the launcher; replaces the older short one)
 *   -> docs/Asterhaven_Lorebook.txt               the plain-text reference document (same words)
 * Edit the sections below, run this, then build.
 *
 * Priorities (lorebook order): the cast lorebooks use 39-60; every keyword entry here is 10-30, so the cast always wins
 * when the token budget is tight. Only three short entries are always on.
 */
const fs = require('fs');
const path = require('path');

const VERSION = '2.0';
const DATE = '17 October 2026';

// part: heading in the document. mode 'always' = always sent (keep short). pri = priority of keyword entries.
const S = [];
const add = (part, title, keys, pri, text, mode = 'keywords') => S.push({ part, title, keys, pri, mode, text: text.trim() });

// ------------------------------------------------------------------------------------------------ 0 ALWAYS ON
const P0 = '0. THE SHORT VERSION (always active)';
add(P0, 'Core Setting', [], 0, `
Asterhaven is a contemporary coastal college town. Humans and demihumans live together as ordinary neighbours, students, workers and friends. The tone is slice of life, romance, comedy and drama; everyday routines are the baseline (classes, shifts, rent, friends, weather), and extraordinary events happen only when a story deliberately brings them in. The town and its residents exist independently of {{user}}: they have homes, jobs, classes, schedules and lives of their own.
Demihumans are human in overall appearance with inherited traits such as ears, tails, horns, scales or unusual eyes. Kemonomimi style is the default: ears and a tail, human skin everywhere else, never a fur-covered animal body. Species never decides personality, morality, intelligence, religion or romance.
Main places: Asterhaven University and the University Quarter, the Student Residential District (Marlowe Hall), Old Town, the Harborfront and the Residential Neighborhoods. Use only established places; unnamed ordinary places (a corner shop, a bus stop, a lecture hall) may be invented freely if they do not contradict anything.`, 'always');

add(P0, 'Encounter and Continuity Rules', [], 0, `
- Characters have homes, jobs, classes and schedules, and they need plausible time to travel. A routine is a tendency, not a guarantee; the current story state wins when there is a believable reason.
- Before bringing a known character into a scene, check the place, the hour, their commitments, the travel time, whether they could enter that place, and how they would know about the event.
- Characters do not appear in classrooms they do not attend, workplaces where they have no business, or private homes they have no reason to visit. Coincidences are possible but must be credible, never the default explanation.
- Do not invent shared history, friendship, family ties or romance between {{user}} and anyone, or between named characters, unless the story has established it. Never write {{user}}'s words, actions, thoughts, feelings or consent.
- Characters know only what they could plausibly have learned. Rumours stay uncertain until verified. A temporary location or relationship change never overwrites a permanent home, job or enrollment.
- Species and body traits are never an invitation to touch. Consent and privacy apply to everyone.`, 'always');

add(P0, 'User Residence', [], 0, `
{{user}} lives in Marlowe Hall, room 218, a shared double room on the second floor in the Student Residential District. {{user}}'s roommate is Juno Tidewell (otter demi-human, 21, swimmer and Marine Biology student). Scenes set in {{user}}'s own room or in Marlowe Hall happen there unless the story says otherwise.`, 'always');

// ------------------------------------------------------------------------------------------------ 1 GENERAL
const P1 = '1. GENERAL INFORMATION ABOUT ASTERHAVEN';
add(P1, 'Town Overview', ['Asterhaven', 'the town', 'downtown', 'coastal town', 'around town', 'this town'], 30, `
Asterhaven is a coastal town of roughly a hundred and fifty thousand people, large enough that not everyone knows everyone and small enough that people become familiar faces at recurring places. It is shaped by four things: the working harbor, the university, the independent shops and kitchens of Old Town, and the quiet residential streets where long-term families live beside students and hospital staff. Students are visible in some districts but Asterhaven is not only a student town: long-term residents, university staff, healthcare workers, dockworkers, business owners, families and visitors all belong to it.
The place has a recognisable rhythm. Mornings begin at the harbor with deliveries and fog; the day belongs to the University Quarter and the shops; evenings fill the noodle bars, cafes and Harborfront; late nights belong to the bars, the radio, the hospital and the night bus. People walk a lot, take the bus, carry umbrellas, and know which stairwell creaks. The setting supports friendship, romance, comedy, academic pressure, money worries, family obligations, career ambitions and the occasional mystery.
Travel takes time. Nobody crosses town instantly; weather, bus timetables, closing hours and personal commitments decide whether a visit is plausible. Approximate times are in the Getting Around entry.`);

add(P1, 'Climate and Seasons', ['weather', 'rain', 'rainy', 'storm', 'fog', 'foggy', 'snow', 'winter', 'summer', 'autumn', 'umbrella', 'forecast', 'heatwave'], 25, `
Temperate coastal climate, rainy often, never extreme. AUTUMN (September to November): mild and damp, 8 to 16 degrees Celsius, maple and oak leaves everywhere, sudden showers, golden light in the afternoon, fog over the harbor in the early morning. WINTER (December to February): cool and wet, 2 to 9 degrees, strong wind off the water, frost on some mornings, snow once or twice a year and rarely for long. SPRING (March to May): fresh, changeable, cherry blossoms in Old Town in April, wet but brightening. SUMMER (June to August): warm, 20 to 27 degrees, long evenings, the promenade and the beaches full, thunderstorms on the hottest days.
Weather is part of ordinary life: people share umbrellas, rain moves study sessions indoors, wet coats pile up in the Marlowe Hall stairwell, harbor fog delays the dawn deliveries. Demihuman bodies react to weather in individual ways (damp tails, cold ears, shedding in spring); never assume a species rule.`);

add(P1, 'Calendar and Academic Year', ['term', 'semester', 'midterms', 'exams', 'finals', 'winter break', 'orientation', 'graduation', 'deadline', 'enrolment', 'enrollment', 'registration week'], 25, `
Working calendar. AUTUMN TERM starts in the last week of September; orientation week comes just before it. Midterms fall in early to mid November. Lectures end in mid December, exams follow, and winter break lasts until the first week of January. SPRING TERM runs from mid January to mid May with a short break in the middle; finals are in May; graduation is in June. Summer break is June to early September, when many students stay in Asterhaven to work or study.
Annual events: the Lantern Gala (a formal student evening run by the Student Union and the Lantern Society) in late November; the harbor lantern walk in December; the Old Town spring market in April; the swim-team home meet in March. Dates are approximate; a story may move them. Individual class timetables are not fixed until a character's chat establishes them.`);

// ------------------------------------------------------------------------------------------------ 2 UNIVERSITY
const P2 = '2. ASTERHAVEN UNIVERSITY AND STUDENT LIFE';
add(P2, 'Asterhaven University', ['Asterhaven University', 'the university', 'university', 'lecture', 'professor', 'faculty', 'lecture hall', 'campus'], 30, `
Asterhaven University is a medium-to-large public university with several faculties, around twenty thousand students, research and creative programmes, a large number of student organisations and an active social life. Its heart is the University Quarter, a walkable cluster of brick and stone buildings, lecture halls, laboratories, the library, a glasshouse, an observatory dome, the pool, a campus radio station and the Student Union. Many students live in the Student Residential District next door; staff and older students live all over town.
Institutions: the Student Union (student government, Student Union Office); the Lantern Society (an invitation-led student society for events, run by Delphine Ashcroft); WAST 88.1 (campus radio); the swim team and other athletics; many clubs. Brine Hall houses the Faculty of Humanities; the University Glasshouse is the botanical garden; the observatory dome sits above the physics building.
Humans and demihumans are both students and staff; the university has accessible rooms, an aquatic facility and species-aware health support, built around individual needs. The exact course catalogue, professors' timetables and building floor plans are not fixed unless a character's chat establishes them.`);

add(P2, 'Academic Areas', ['major', 'degree', 'faculties', 'department', 'thesis', 'field of study', 'studying', 'course load'], 20, `
Planning framework, not a fixed catalogue. COMPUTING AND ENGINEERING: Computer Science, Software Engineering, Artificial Intelligence, Cybersecurity, Electrical and Mechanical Engineering, Data Science. MATHEMATICS AND NATURAL SCIENCES: Mathematics, Statistics, Physics, Astronomy, Chemistry, Biology, Marine Biology, Botany and Horticulture, Ecology, Environmental Science. HUMANITIES AND SOCIAL SCIENCES: Psychology, Sociology, Anthropology, History, Maritime History, Folklore and Cultural Studies, Literature, Philosophy, Linguistics, Political Science, Communications. HEALTH AND LIFE STUDIES: Nursing, Public Health, Physiotherapy, Nutrition, inclusive healthcare studies. ARTS AND CREATIVE PRACTICE: Fine Arts, Graphic Design, Film, Music, Creative Writing, Photography, Performing Arts. BUSINESS AND PROFESSIONAL STUDIES: Business Administration, Economics, Accounting, Marketing, Finance, Law, Hospitality.
Degrees are four years of undergraduate study (first to fourth year). A character's enrollment, schedule and courses must be established before they constrain a scene.`);

add(P2, 'Student Life and Traditions', ['student union', 'Lantern Society', 'Lantern Gala', 'student council', 'student government', 'clubs', 'society', 'pizza night', 'swim meet', 'student life'], 22, `
Student life runs on small recurring things. FLOOR PIZZA NIGHT: every Thursday evening in the Marlowe Hall common room, run by whoever is loudest (usually Juno). STUDENT UNION: elected student government with an office in the University Quarter; it runs welfare, clubs funding and events; president is Delphine Ashcroft. LANTERN SOCIETY: an invitation-led society with its own lounge, known for the Lantern Gala, a formal late-November evening that half the campus pretends not to care about. WAST 88.1: the campus radio, with overnight shows. SWIM TEAM: morning practices at the university pool and home meets in March. CLUBS: dozens, from hiking and board games to a marine biology volunteer group and a folklore reading circle.
Ordinary habits: studying in the library or the Glasshouse, cheap dinners in Old Town, walks along the Harborfront, laundry in basements, group chats about deadlines, and complaining about the elevator.`);

add(P2, 'Money, Work and Housing', ['rent', 'tuition', 'budget', 'part-time job', 'scholarship', 'housing office', 'student loan', 'cost of living', 'paycheck'], 15, `
Most students are careful with money. Rent in a Marlowe Hall double is modest; shared apartments and small flats cost more; Harborfront housing is expensive. Many students hold part-time jobs (bookshop, noodle bar, bar, hospital tech, glasshouse assistant, radio engineer), usually in the evenings. Scholarships, student loans and family support differ widely and shape how people spend and worry. The housing office allocates dorm rooms and occasionally makes mistakes. Money, schedules and fatigue are legitimate sources of story, never a joke at someone's expense.`);

// ------------------------------------------------------------------------------------------------ 3 DISTRICTS
const P3 = '3. DISTRICTS AND GETTING AROUND';
add(P3, 'University Quarter', ['University Quarter', 'university quarter', 'the quarter', 'quad', 'campus cafe', 'lecture halls'], 28, `
The academic and student-life centre: lecture halls, laboratories, Brine Hall, the library, the Student Union Office and Lantern Society lounge, the University Glasshouse, the observatory dome, the university pool, the campus radio station, a campus cafe and a central quad with maple trees. Busiest between classes and at midday; quiet and lamp-lit at night. Marlowe Hall and the Student Residential District are a ten-minute walk away; the Harborfront is about twenty minutes on foot or eight by bus.`);

add(P3, 'Student Residential District', ['Student Residential District', 'student district', 'student apartments', 'student housing', 'dormitories', 'laundromat'], 28, `
University residences, shared student apartments, laundromats, convenience stores, cheap restaurants, copy shops and everyday student hangouts. Streets are narrow, brick, lined with maples and bicycles. Marlowe Hall is the main dorm. Teodor Lindqvist and Mara Venn live in shared or small apartments here. The University Quarter is a ten-minute walk; Old Town is fifteen to twenty minutes on foot (five by bus).`);

add(P3, 'Old Town and Commercial Streets', ['Old Town', 'old town', 'commercial street', 'bookstore', 'independent cafe', 'local shops', 'noodle street'], 28, `
Cobbled and brick streets of independent cafes, small restaurants, bookstores, clothing and record shops, tailors and repair counters, with apartments above the shops. The oldest part of Asterhaven, busy at lunch and from early evening, closed up by about ten. Landmarks: Tideglass Books and Kettle & Ladle Noodle Bar. Cherry trees line the main street and bloom in April. Ten minutes on foot to the Harborfront, fifteen to twenty from the Student Residential District.`);

add(P3, 'Harborfront', ['Harborfront', 'harborfront', 'harbor', 'harbour', 'waterfront', 'promenade', 'marina', 'docks'], 28, `
The working and leisure waterfront: docks and warehouses at the east end, a public promenade with benches and viewpoints in the middle, small marinas, waterfront dining and bars. Fog in the early morning, gulls all day, lamps at night. Cassian Mercer's bar, The Salt Lantern, stands here, and the Ashcroft family shipping business has its offices on the same stretch. Expensive flats (including penthouses) overlook the water. Twenty minutes on foot from the University Quarter, ten from Old Town.`);

add(P3, 'Residential Neighborhoods', ['Residential Neighborhoods', 'residential neighborhood', 'local neighborhood', 'neighbourhood', 'residential apartments', 'grocery store', 'pharmacy'], 26, `
Houses, residential apartment blocks, neighborhood shops, parks, schools, supermarkets, pharmacies and the town's hospital, for residents whose lives are not centred on the university. Quieter, greener and slower than the student districts. Asterhaven General Hospital is here, and Odette Marchetti rents a flat in this area. Twelve minutes by bus from the University Quarter, fifteen from Old Town.`);

add(P3, 'Getting Around', ['bus', 'night bus', 'transit', 'commute', 'commuting', 'bike', 'bicycle', 'taxi', 'bus stop', 'walk to'], 24, `
Asterhaven is walkable. APPROXIMATE TIMES: Marlowe Hall to the University Quarter 10 minutes on foot; Student Residential District to Old Town 15 to 20 on foot or 5 by bus; Old Town to the Harborfront 10 on foot; University Quarter to the Harborfront 20 on foot or 8 by bus; University Quarter to the hospital 12 by bus; Old Town to the hospital 15 by bus.
BUSES: the Harbor Line links the Harborfront, Old Town and the University Quarter every 12 minutes until midnight; Line 4 serves the residential neighborhoods and the hospital; the Night Owl runs hourly until about 2:30 AM on the Harbor Line route. Many students cycle. Taxis exist but are costly and rare. A bad rain day adds ten minutes to everything.`);

// ------------------------------------------------------------------------------------------------ 4 LOCATIONS
const P4 = '4. LOCATIONS (ALL ESTABLISHED PLACES)';
add(P4, 'Marlowe Hall', ['Marlowe Hall', 'Marlowe', 'dorm', 'dorm room', 'dormitory', 'residence hall', 'common room', 'stairwell', 'elevator'], 30, `
[MARLOWE HALL: THE USER'S DORM]
A co-ed student residence in the Student Residential District: a five-floor brick building from the 1960s with a creaky stairwell, a small elevator that is usually out of service, and a common room on the ground floor. The first floor holds single rooms, the mail room and a shared kitchen; floors two to five hold double rooms. Bathrooms are shared on each floor, the laundry is in the basement, and the roof is locked. Quiet hours run from 11 PM to 7 AM. The University Quarter is a ten-minute walk away. The second floor smells of popcorn, floor polish and burnt toast; doors bang, music leaks through thin walls and everybody knows everybody's schedule.
Residents: {{user}} and Juno Tidewell (room 218, second floor); June Halloran (first floor, room 14, single). Thursday is floor pizza night in the common room. The housing office is in the administration building in the University Quarter and is slow.`);

add(P4, 'Room 218', ['room 218', '218', 'our room', 'my room', 'the room', 'roommate', 'roommates'], 30, `
[ROOM 218: {{user}} AND JUNO'S ROOM]
Second floor, east end of Marlowe Hall. The brass number hangs crooked, with a hand-drawn paper fish taped beneath it. A double room: two beds on opposite walls, two desks, a built-in wardrobe wall, a small fridge, a window over a maple tree (and, if you lean, a slice of the harbor between two roofs). Juno's half is a cheerful avalanche of towels, goggles, swim-team hoodies, sea-glass and a poster of a moonlit sea; wet footprints mark the floor near the door. The room is never silent while Juno is awake. Quiet hours start at 11 PM.`);

add(P4, 'Marlowe Hall Basement and Common Room', ['basement', 'laundry', 'laundry room', 'mail room', 'shared kitchen', 'floor kitchen'], 26, `
The basement laundry has six machines, two always broken, a folding table and a bench where people talk at midnight. Juno is here constantly because of the towels. The ground-floor common room has sagging sofas, a television nobody controls, board games and a corkboard of flyers; it hosts Thursday pizza night. Beside it are the mail room (pigeonholes by room number) and the shared kitchen, whose fridge is a battlefield of labelled leftovers.`);

add(P4, 'Student Apartments', ['shared apartment', 'student apartment', 'plant apartment', 'flat share', 'apartment block'], 24, `
Shared student apartments fill the streets around Marlowe Hall: three- and four-storey blocks, thin walls, radiators that clank, noisy neighbors. Mara Venn shares one (roommates not yet established). Teodor Lindqvist lives alone in a small apartment crowded with plants on every sill and shelf, labelled in his untidy handwriting. Rent and the landlord's patience are common topics.`);

add(P4, 'Brine Hall', ['Brine Hall', 'Humanities building', 'faculty office', 'office hours', 'Professor Fenwick', 'Fenwick', 'Goldie'], 30, `
The Faculty of Humanities building in the University Quarter: stone, tall windows, creaking floors, maps and old ship models in the corridors. Lecture halls on the lower floors; offices above. Marigold "Goldie" Fenwick's third-floor office is a tidy-looking avalanche of papers, sea charts, mugs and a kettle that is not allowed there. Lectures in the morning, office hours in the afternoon, and her light is often still on late into the evening.`);

add(P4, 'Student Union Office and Lantern Society Lounge', ['Student Union Office', 'Union office', 'Lantern Society lounge', 'Lantern lounge', 'Union building'], 30, `
The Student Union Office is a busy first-floor suite in the University Quarter: a noticeboard wall, a meeting table, a long list of grievances and a kettle shared by too many people. Delphine Ashcroft presides over most afternoon and evening meetings. The Lantern Society lounge is its more exclusive neighbor: velvet sofas, brass lamps, framed photographs of past galas, quiet music; entry is by invitation, and nothing is said there that is not meant to be. Together they host the Lantern Gala each November.`);

add(P4, 'University Glasshouse', ['Glasshouse', 'University Glasshouse', 'greenhouse', 'botanical garden', 'orchid house', 'botany lab'], 30, `
A Victorian-style glass and iron botanical garden behind the science buildings, humid and green even in winter. Palm and fern house, an orchid room, a cactus corner, benches among the vines, a potting shed and a small teaching lab. Quiet, warm and a refuge for students who need silence. Teodor Lindqvist works here as a student horticulture assistant, mornings and late afternoons. Rain on the glass roof is loud.`);

add(P4, 'Observatory Dome', ['observatory', 'observatory dome', 'telescope', 'stargazing', 'physics building roof'], 28, `
A white dome on the roof of the physics building with a small research telescope and a smaller one for open nights. Access needs a key from the physics department; open nights on clear Fridays welcome everyone. June Halloran does thesis work here. Cold, silent and brilliant when the sky is clear, which in Asterhaven is not often.`);

add(P4, 'Campus Radio Station WAST', ['campus radio', 'radio station', 'WAST', 'WAST 88.1', 'Midnight Static', 'radio booth'], 28, `
WAST 88.1, the student radio station, in a cramped basement suite in the University Quarter: foam-covered walls, a mixing desk older than its volunteers, a booth with a window onto the corridor and a red ON AIR light. Overnight programming runs through the weeknights; June Halloran hosts the late-night show "Midnight Static" (about 11 PM to 2 AM) and fixes the equipment when it breaks. Listeners are loyal, few and chatty.`);

add(P4, 'University Pool and Marine Biology Lab', ['university pool', 'campus pool', 'swim team', 'swimming pool', 'marine biology lab', 'aquatics', 'swim practice'], 28, `
The university pool is a fifty-metre indoor pool with a viewing gallery, home of the swim team; early practices are 6 to 8 AM and open swim is in the evenings. Aquatic and semi-aquatic demihumans may have swim-time priority; individual comfort in water varies. The marine biology lab is next door: tanks, microscopes and a salt-smelling cold room where Juno Tidewell volunteers.`);

add(P4, 'University Library and Campus Cafe', ['library', 'university library', 'study room', 'folklore stacks', 'campus cafe', 'study session'], 26, `
A big stone library with reading rooms, silent floors, bookable group rooms, a rare-books room and a quiet corner of folklore stacks where students of Folklore and Cultural Studies spend hours. Open late during exam periods. The campus cafe on the quad serves strong coffee, pastries and a lunch queue that backs up between classes.`);

add(P4, 'Tideglass Books', ['Tideglass Books', 'Tideglass', 'used bookstore', 'used books', 'secondhand bookstore', 'bookshop', 'Ezra Quill', 'Quill'], 30, `
An independent used bookstore in Old Town: narrow, dusty, floor-to-ceiling shelves, ladders, handwritten price tags, a back room with a kettle and a sleeping armchair. The owner, Ezra Quill (68, human), knows a rumour about every old book. Mara Venn works here part-time; shifts are not fixed, so afternoons and weekends are plausible. Closed by about 7 PM.`);

add(P4, 'Kettle & Ladle Noodle Bar', ['Kettle & Ladle', 'Kettle and Ladle', 'noodle bar', 'noodle shop', 'ramen shop', 'ramen bar', 'Hanae Okabe', 'Okabe'], 30, `
A small family-run noodle shop in Old Town: eight stools at the counter, four small tables, steamed windows, a lucky cat by the register and a menu written on a chalkboard. Owner and head cook Hanae Okabe (63, human) runs the kitchen; Riko Kitsumi works the floor and prep in the evenings, roughly 5 PM to close, and eats leftovers after hours. Riko rents a small room in the building above a shop on the same street. The bar fills with students at dinner time and with night-shift workers after ten.`);

add(P4, 'The Salt Lantern', ['Salt Lantern', 'The Salt Lantern', 'harbor bar', 'harbour bar', 'bar on the harborfront', 'dockside bar', 'Cassian'], 30, `
A harbor bar on the Harborfront: dark wood, a long counter, lanterns hanging from the beams, brass fittings, shelves of bottles, and a window onto the boats. Owner and head bartender Cassian Mercer (29, wolf demi-human) lives in the small flat above. Opens in the late afternoon and closes around 2 AM most days; dockworkers, students, couples and insomniacs mix. Calm, a little salty, and very well run.`);

add(P4, 'Harborfront Promenade and Docks', ['promenade', 'docks', 'dock', 'pier', 'marina', 'boardwalk', 'harbor walk', 'lantern walk'], 26, `
The promenade is a wide waterfront walk with benches, street lamps and viewing points, busy at sunset and quiet at night. The docks at the east end handle fishing boats and small cargo; early-morning deliveries and fog make them atmospheric at dawn. The lantern walk in December lines the promenade with paper lanterns.`);

add(P4, 'Ashcroft Shipping and the Penthouse', ['Ashcroft Shipping', 'Ashcroft', 'penthouse', 'shipping office', 'Ashcroft family'], 26, `
Ashcroft Shipping is a long-established family firm with offices and warehouses on the Harborfront. Delphine Ashcroft, heir and fourth-year student, lives in a large penthouse flat above the water: glass, white stone, a view of the whole harbor. The family's influence is local rather than limitless; the firm employs many dockworkers and sponsors the Lantern Gala.`);

add(P4, 'Asterhaven General Hospital', ['Asterhaven General', 'General Hospital', 'hospital', 'emergency room', 'emergency department', 'the ER', 'ambulance', 'clinic'], 30, `
The town's main hospital in the Residential Neighborhoods: seven floors, a busy Emergency Department, wards, outpatient clinics, a staff break room with a cranky vending machine and a cafeteria with poor coffee. Staff and students on clinical placement treat people as patients, not specimens, regardless of species. Odette Marchetti works here as an ED tech and final-year nursing student, usually on long shifts around 7 AM to 7 PM, three or four days a week.`);

add(P4, 'Odette Marchetti Flat', ['Odette flat', 'small rented flat', 'Odette home', 'two cats'], 22, `
A small rented flat in the Residential Neighborhoods, with a tiny kitchen that always smells of baking (flour on every surface), a sofa the cats own, and a pile of scrubs on a chair. Odette shares it with two cats. Visitors are rare and welcome.`);

add(P4, 'Corvane University and the Research Center', ['Corvane', 'Corvane University', 'Research Center', 'CURC', 'Secure Annex', 'observation room', 'Larkspur Hall', 'Grey Heron'], 20, `
[ROUTE-ONLY SETTING] Corvane University is a separate red-brick research university in another town, far enough that nobody commutes to it from Asterhaven. Old oaks, a river behind the science quad, the Research Center at the north edge with a locked Secure Annex. Larkspur Hall is a four-floor dorm with a creaky front door and a courtyard bench where people wait for friends; the cafe The Grey Heron is two blocks away. This setting belongs to Mirel's scripted route and stays out of ordinary Asterhaven chats; it does not make extraterrestrial life part of the default setting.`);

// ------------------------------------------------------------------------------------------------ 5 PEOPLE
const P5 = '5. SPECIES, BIOLOGY AND CULTURE';
add(P5, 'Humans and Demihumans', ['demihuman', 'demihumans', 'kemonomimi', 'human', 'species', 'animal ears', 'tail', 'horns'], 30, `
Humans and demihumans coexist throughout Asterhaven and are ordinary members of society, sharing civic, academic, professional and social life. Demihumans are generally human in overall appearance, with animal-associated or other inherited traits such as ears, tails, horns, unusual eyes, scales or fins. Some lineages may have more substantially different bodies. The kemonomimi style is the default for this setting: ears and a tail, human skin everywhere else, no fur-covered body and no animal head. Fully animal-bodied or animal-headed peoples are not part of the default look and appear only if canon deliberately allows them.
Species can affect anatomy, accessibility needs, sensory experience, health considerations and cultural practices, but species never determines personality, intelligence, morality, occupation, beliefs, politics or romantic preferences. Curiosity about an uncommon trait may happen; difference is not automatically a source of exclusion. Prejudice can exist in particular people or situations without becoming the explanation for every conflict. Where details of a species are not settled, do not invent a universal rule. A visible ear, tail, horn or scale pattern is never an invitation to touch.
HUMANS have no demihuman traits by definition and vary widely in ancestry, culture, appearance, ability, belief and family background; humanity is not a single culture or worldview.
`);

add(P5, 'Everyday Species', ['nekomimi', 'okamimimi', 'inumimi', 'kitsune', 'usagimimi', 'shikamimi', 'kawausomimi', 'tanuki', 'nezumimimi', 'cat girl', 'wolf girl', 'fox girl', 'rabbit', 'otter', 'deer'], 22, `
NEKOMIMI, CAT DEMIHUMANS: usually cat ears and often a tail, with variation in fur pattern, eyes, nails, hearing and body language. Cat-like mannerisms are not compulsory and no temperament should be assumed.
OKAMIMIMI, WOLF DEMIHUMANS: wolf-like ears, possibly a tail, sharper senses or other canine traits. Social habits range from solitary to highly sociable. Not automatically aggressive, territorial, obedient or pack-oriented.
INUMIMI, DOG DEMIHUMANS: dog-like ears and sometimes a tail; many lineages with different appearances and sensory profiles. Loyalty, friendliness and behavior are individual traits, not species guarantees.
KITSUNE, FOX DEMIHUMANS: fox ears and one or more tails; tail number, colour and other traits vary by lineage. Several tails are uncommon, though exact rarity is not quantified. Kitsune are not automatically magical, deceptive, spiritual or tied to a faith.
USAGIMIMI, RABBIT DEMIHUMANS: long or lop ears and a small round tail; the ears are expressive and often give away mood without the person wanting them to. Not automatically timid, nor automatically anything else.
SHIKAMIMI, DEER DEMIHUMANS: deer ears (sometimes speckled) and a short tail with a pale underside; ears and tail may react to sudden sounds by reflex, which says nothing about courage or personality.
KAWAUSOMIMI, OTTER DEMIHUMANS: small round ears, a thick tapering tail and a body well suited to water; many swim well, but ability and comfort in water vary.
TANUKI, RACCOON-DOG DEMIHUMANS: round ears and a thick bushy tail; tails may puff or fluff with strong emotion. Not automatically tricksters, shapeshifters or liars.
NEZUMIMIMI, MOUSE OR RAT DEMIHUMANS: rounded ears and a thin tail with species-associated sensory or physical traits; mouse and rat lineages need not be identical. Size, temperament, diet and social habits vary by individual.
None of these labels gives a fixed temperament, ability or role.
`);

add(P5, 'Rarer Species', ['fukuroumimi', 'washimi', 'haienamimi', 'makohire', 'shachihire', 'owl', 'hawk', 'eagle', 'hyena', 'shark', 'orca'], 20, `
FUKUROUMIMI, OWL DEMIHUMANS: may have feathered ear tufts, owl-associated facial or eye traits or other lineage-specific features. Hearing, vision, sleep patterns and feather-care needs are defined per person; not inherently nocturnal, aloof or wise.
WASHIMI, EAGLE OR HAWK DEMIHUMANS: may show raptor-like ear, feather, eye or limb traits. Exceptional vision or flight anatomy exists only where a character's specific design supports it; wings and flight are not automatic. Not inherently proud, predatory or dominant.
HAIENAMIMI, HYENA DEMIHUMANS: may have rounded ears, a short tail, patterned markings or other hyena traits. Vocalisations can be misunderstood by people unfamiliar with them; a laugh-like sound does not necessarily mean amusement. No fixed temperament follows.
MAKOHIRE, SHARK DEMIHUMANS: may have fin-like structures, a tail, specialised skin or other aquatic adaptations. Water access, temperature, hydration and mobility depend on individual anatomy; do not assume excellent swimming, danger or comfort in deep water.
SHACHIHIRE, ORCA DEMIHUMANS: may have cetacean-associated markings, fin or tail traits and aquatic adaptations. Swimming ability and comfort around water vary; appearance does not determine personality, family culture or occupation.
These lineages are rarer; their presence is real but never required in a scene.
`);

add(P5, 'Dragons, Serpents and Other Lineages', ['draconid', 'dragon', 'lamia', 'gorgon', 'hellhound', 'vampire', 'demonid', 'succubus', 'incubus', 'horns', 'scales'], 20, `
DRACONIDS, DRAGON-FEATURED PEOPLE: may have horns, scales, tails, unusual eyes, claws or other dragon-associated traits. Families may develop their own identities and customs, but clan membership is not universal; a draconid is not automatically ancient, wealthy, powerful, magical or part of a formal clan.
LAMIAS AND GORGON-RELATED PEOPLE: some have a serpentine lower body, others more limited snake-associated traits; the terms may name distinct communities and are not interchangeable. Anatomy can affect seating, clothing, transport, housing access and medical care, so needs are handled practically and respectfully. No caste, gender role, occupation or religious duty is attached.
HELLHOUND-ASSOCIATED PEOPLE: a canine-featured lineage or a cultural name for people with unusual traits. Dark colouring, heat tolerance or supernatural origin are not guaranteed; the word does not prove a person is infernal or dangerous.
VAMPIRE-ASSOCIATED PEOPLE: whether vampirism is a species, inherited trait, medical condition or supernatural state is undecided. Do not assume immortality, blood predation, sunlight weakness, contagion or any familiar vampire rule unless a later decision defines it.
DEMONID-ASSOCIATED PEOPLE: may have horns, tails, unusual eyes or other traits described as demon-like. The label does not make anyone evil, supernatural, sexually available or aligned with a religion.
INCUBUS- OR SUCCUBUS-ASSOCIATED TRAITS: optional inherited or supernatural labels if a story includes them. They never imply sexual behavior, attraction, seduction, availability or consent, and their biological status is not defined.
`);

add(P5, 'Open Categories', ['windigo', 'wendigo', 'leshen', 'the Bloom', 'bloom', 'anthropomorphic', 'Drift', 'alien', 'extraterrestrial'], 16, `
WINDIGO, WENDIGO and LESHEN are distinct traditions and are not casually merged into one species; their literal existence in Asterhaven is not established. If a story uses a category inspired by a real tradition, it is developed carefully and unrelated traditions are not presented as interchangeable monster lore.
THE BLOOM is reserved for a possible extraterrestrial or parasitic lifeform concept. It is not part of Asterhaven's everyday setting; its existence, biology and role are unconfirmed, and introducing it requires a deliberate genre and canon decision.
ANTHROPOMORPHIC PEOPLES (fully animal-bodied or animal-headed) are distinct from the kemonomimi baseline and are not present by default; including them needs a clear setting decision.
THE DRIFT is the amorphous extraterrestrial species of Mirel's self-contained route set at Corvane University. It does not exist in the default Asterhaven setting.
`);

add(P5, 'Biology, Inheritance, Accessibility and Health', ['inheritance', 'genetics', 'accessibility', 'accommodation', 'medical', 'health', 'sick', 'illness', 'doctor', 'research ethics'], 18, `
No single inheritance model is fixed. Do not assume a child always takes one parent's species, that traits always combine, or that one trait always overrides another. Species and traits can be distinct categories (a supernatural or medical condition could coexist with inherited traits), but such combinations are not automatically confirmed; avoid multiplying traits without a character-specific reason.
There is no universal species strength ranking. Physical capability depends on anatomy, training, health, environment and individual variation, and a species label alone never decides a conflict.
Accessibility is part of ordinary life. Some people need adapted seating, wider circulation space, aquatic facilities, temperature management, mobility support, sensory accommodations, specialised clothing or particular medical expertise. Accommodations follow the person's actual needs, not stereotypes. Examples: tail-friendly chairs in lecture halls, early swim slots, quieter study rooms, warm rooms in winter.
Healthcare treats demihumans as patients, not specimens. Species-aware medicine can help, but diagnosis and treatment require individual assessment. Research involving people needs informed consent, privacy and ethical oversight.
`);

add(P5, 'Culture, Religion and Clans', ['religion', 'faith', 'shrine', 'temple', 'clan', 'ritual', 'pray', 'tradition', 'festival', 'cultural'], 15, `
Asterhaven has a plural religious and philosophical landscape: established religions, local traditions, personal practice, secular philosophies, mixed practice or none. The objective reality of gods, spirits, magic and supernatural claims is not established. No species has one universal religion; a person's species does not prove their faith, ritual practice or relationship to the supernatural. Religious communities include people of different species.
Egyptian and Kemetic-inspired practice may be followed by individuals or communities, but it is not the religion of cat demihumans or any other species and does not establish a pantheon as real. Shinto and other Japanese practices may be followed by individuals and communities; kitsune traits do not establish religious status, magical ancestry or shrine membership. Real-world-inspired religions are depicted respectfully, separating researched tradition from invented detail.
Draconid families may form clans or lineages with histories, names, kinship structures, crafts, dialects and rituals, but such clans are optional and specific to Asterhaven; no named clan, homeland or conflict is established, and members may interpret customs differently across generations or in diaspora. Bat-associated and other uncommon communities may keep distinctive traditions, but no isolated nation, language or ritual system is canon. Lamias and gorgon-related people have no default caste, gender hierarchy, compulsory occupation or species-wide religious role. No universal clan hierarchy, matriarchy, patriarchy, marriage law, family structure or bloodline rule exists; families disagree internally and customs may be followed, adapted, challenged or rejected.
`);

add(P5, 'Magic and the Supernatural', ['magic', 'spell', 'ghost', 'spirit', 'curse', 'supernatural', 'haunted', 'witch'], 15, `
Asterhaven's default setting is contemporary and grounded in everyday life. Magic, spirits, gods acting openly, demons as real beings, extraterrestrial organisms and supernatural research are not confirmed facts. Characters may have personal beliefs, stories, traditions or doubts about such matters without the narration declaring them true. If supernatural elements are added later, their rules, limits, visibility, consequences and effect on ordinary society must be defined in a dedicated update first. A species label alone never establishes magical ability.
`);

add(P5, 'Social Life, Romance and Boundaries', ['dating', 'romance', 'flirt', 'flirting', 'courtship', 'boundaries', 'consent', 'first date', 'relationship', 'crush'], 15, `
Humans and demihumans study, work, form friendships, date, disagree, take part in clubs, care for family and make ordinary choices. Species differences can matter in daily life without being all that defines a person.
Romance is individual, not species-scripted: no species has a universal courtship ritual, preferred partner type, mating season, scent-marking custom or relationship structure unless a specific character or community establishes one, and individuals vary within it. Body language and sensory cues can differ and no cue is universally understood; ears, tails, horns, scales, scent and vocalisations are not a reliable way to read feelings without context and communication.
Respect personal boundaries. A visible tail, ear, horn or scale pattern is never an invitation to touch. Consent and privacy apply equally to everyone. Do not write consent, feelings or actions for {{user}}.
`);

// ------------------------------------------------------------------------------------------------ 6 DIRECTORY
const P6 = '6. CAST DIRECTORY';
add(P6, 'Residents Directory', ['who lives here', 'residents', 'everyone in town', 'people in town', 'the cast', 'who works at', 'who is there'], 10, `
Established residents (ages, places, usual hours); full profiles are in the Characters lorebook.
- Juno Tidewell, 21, otter, Marine Biology (3rd year): {{user}}'s roommate, Marlowe Hall room 218; swim practice 6 to 8 AM; in the room most evenings.
- June Halloran, 21, cat, Astronomy and Physics (3rd): Marlowe Hall room 14; WAST radio 11 PM to 2 AM weeknights; observatory dome.
- Mara Venn, 21, human, Environmental Science (3rd): shared student apartment; part-time at Tideglass Books (afternoons and weekends).
- Teodor Lindqvist, 21, fallow deer, Botany and Horticulture (3rd): plant-filled apartment; University Glasshouse mornings and late afternoons.
- Riko Kitsumi, 22, two-tailed kitsune, Folklore and Cultural Studies (4th): room above a shop in Old Town; Kettle & Ladle from about 5 PM to close.
- Delphine Ashcroft, 22, lop-eared rabbit, Economics and Political Science (4th): Student Union president and Lantern Society founder; penthouse on the Harborfront; meetings afternoons and evenings.
- Odette Marchetti, 24, golden retriever, Nursing (4th): small flat in the Residential Neighborhoods; Asterhaven General ED, long daytime shifts.
- Cassian Mercer, 29, wolf: owner of The Salt Lantern; flat above the bar; open late afternoon to about 2 AM.
- Marigold "Goldie" Fenwick, 38, tanuki: associate professor of Maritime History and Coastal Folklore, Brine Hall; lectures mornings, office hours afternoons.
- Hanae Okabe, 63, human: owner and cook of Kettle & Ladle. Ezra Quill, 68, human: owner of Tideglass Books.
- Mirel: Corvane University Research Center route only; not a resident of Asterhaven.`);

// ================================================================================================ outputs
const outWorld = path.join(__dirname, '..', 'core', 'worlds', 'Asterhaven.zenith-world.json');
const outDoc = path.join(__dirname, '..', 'docs', 'Asterhaven_Lorebook.txt');

const world = {
  schema_version: '1.0', project: 'ZenithTavern',
  world: { id: 'asterhaven', name: 'Asterhaven', managed: true, university: { id: 'asterhaven_university', name: 'Asterhaven University', status: 'established' },
    setting: { era: 'contemporary', genre_tones: ['slice of life', 'romance', 'comedy', 'interpersonal drama', 'academic life', 'friendship', 'career ambitions', 'occasional mystery'] } },
  entries: S.map((e, i) => ({
    id: `ast_${String(i).padStart(2, '0')}_${e.title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`,
    name: e.title, category: e.part,
    activation: e.mode === 'always' ? { mode: 'always' } : { mode: 'keywords', priority: e.pri },
    keys: e.mode === 'always' ? [] : [...new Set([e.title, ...e.keys])],
    prevent_recursion: true,
    content: e.text,
  })),
  design_notes: [
    'Rewritten 17 October 2026 (version 2.0): full lore with every established location. Replaces the shorter Asterhaven lorebook.',
    'Only three short entries are always on. Everything else is keyword-activated with priority 10 to 30, below the Characters and Sub-bots lorebooks.',
    'Source: tools/asterhaven-lore.cjs. The same words are written to docs/Asterhaven_Lorebook.txt.',
    'Travel times, bus lines, the academic calendar and the climate are working canon: consistent, but easy to change.',
  ],
};
fs.writeFileSync(outWorld, JSON.stringify(world, null, 2));

let doc = `ASTERHAVEN — WORLD LOREBOOK
ZenithTavern | Plain-text world reference | Version ${VERSION} | ${DATE}

PURPOSE
This document is the full reference for Asterhaven: the town, the university, the districts, every established location, the species and culture, and the people who live there. It matches the "Asterhaven" lorebook that ships with ZenithTavern. Short entries that must always be known are marked as always active; everything else is activated by keywords and has lower priority than the character lorebooks. Asterhaven is its own setting; no outside setting's place names, institutions, histories, characters or cultural systems are part of its canon.
Status: places, times and calendars below are working canon: consistent and ready to use, but open to change by a deliberate decision.
`;
let part = '';
for (const e of S) {
  if (e.part !== part) { part = e.part; doc += `\n${'='.repeat(78)}\n${part}\n${'='.repeat(78)}\n`; }
  doc += `\n${e.title.toUpperCase()}${e.mode === 'always' ? '  [always active]' : ''}\n${e.text.replace(/^\[[^\]]+\]\n/, '')}\n`;
}
doc += `
${'='.repeat(78)}
7. CANON STATUS
${'='.repeat(78)}
ESTABLISHED: contemporary coastal college town; human and demihuman coexistence with a kemonomimi baseline; Asterhaven University; the five districts; every location in section 4; Marlowe Hall room 218 as {{user}}'s room and Juno Tidewell as roommate; the cast in section 6; slice of life, romance, comedy and drama as the tone.
WORKING CANON (consistent, easy to change): the climate and seasons; the academic calendar and annual events; the bus lines and travel times; the size of the town and the university; the course catalogue as a planning framework.
OPEN: the detailed inheritance model; the biology and prevalence of rare species; whether any supernatural category is literally real; individual class timetables; floor plans of buildings other than Marlowe Hall; Mara's roommates; street names and addresses.
SEPARATE SETTING: Corvane University and Mirel's scripted route are self-contained and do not change Asterhaven's default setting.
`;
fs.mkdirSync(path.dirname(outDoc), { recursive: true });
fs.writeFileSync(outDoc, doc);
const words = doc.split(/\s+/).length;
console.log(`Asterhaven: ${S.length} entries (${S.filter((x) => x.mode === 'always').length} always on); document ${words} words`);
