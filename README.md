# Translation Check 2.0.6

Checks whether a web page **or a PDF open in the browser** is fully in the language you pick, and highlights what isn't.
Load this folder in `chrome://extensions` (Developer mode → Load unpacked). Needs Chrome 114+.

## How a warning is decided
1. **tinyld** + rules (numbers, durations, versions, model names, brands and URLs are ignored first) propose a verdict.
2. **CLD3** (Google's detector, WebAssembly) and **franc** vote independently. A model only abstains when it truly has no guess: a correct
   but unconfident guess still counts. **When two models agree, that decides:** two that read the text as the target language withdraw the
   warning (or clear an *unclear*); two that name the same other language raise one (or confirm it). A confident dissent from the third model,
   clearly English wording, or a rule-based reason overrides the agreement. Each warning shows three dots (one per model) and a ✓ when 2+ agree.
   Settings → *Confirmed only* shows nothing that a second model doesn't back.
   **Models are made to vote.** Neighbouring languages count as one answer (CLD3's "Norwegian" agrees with tinyld's "Danish"), and the label is
   the page's own language. A model that abstains, or names a third language unrelated to both (Welsh or Mongolian for one Danish word), is asked
   again head-to-head: *target or the page's own language?* That answer is weak, so it only backs up the dictionary, never replaces it, and two
   head-to-head answers alone never count as agreement. franc's open vote uses franc-min; the head-to-head uses full franc, which knows Danish,
   Norwegian, Finnish and Slovak.
   **English checks use the dictionary as evidence.** A word that isn't English, not even as a plural, ending, prefix or compound ("integrations",
   "reskilling", "roleplay", "datetime"), is untranslated when two models (or one confident model) name the page's own language, even a
   single word ("Hjem", "Træning"). Text whose words are all English that way is translated unless two models agree on another language.
   Danish/Norwegian/Swedish plurals in *-er* ("Personaer", "Rapporter") are never read as English.
   **Labels must fit the letters.** A language is dropped as a label when the text has letters it lacks, and also when 15+ letters of plain a-z
   carry none of the marks it always uses: "Systeemconfiguratie" is not Czech, Polish or Hungarian. The text is then re-read among the common
   Latin-script languages and keeps its warning only if that language (Dutch) really beats the target. Dutch *'s* plurals ("persona's") and
   "help" are not English evidence on Dutch pages.
3. Page-level logic: sentence context, source-language comparison (hreflang), and the "mostly translated" fallback for very short strings.

## "Page's own language" follows the page
Many apps switch the interface language without updating `<html lang>`, which keeps saying "en". So the page's own text decides too:
a page that declares English (or nothing) but whose longer text is mostly another language is checked in that language (its English
leftovers are what the check is for), with a *Page says English* chip. A page that declares another language keeps it, even when much of it
is still English, unless that language is essentially absent (a stale attribute). With live updates on, switching the page's interface
language re-checks it in the new language by itself.

## Titles on Latin-script pages
On a German, French, Danish… page, what two models read as English and is written in title case ("Skill Scout", "Wisight Mapping") is listed
as *Name or title?* and is never cleared by its section, its sentence or the page average, so every copy of the same text gets the same verdict.
A single unknown capitalised word ("Wisight", "Truecost") reads like a native noun ("Thema") to the models, so it is held only when it sits
in the same page slot (element and class: a column of project names, a set of cards) as other held titles. BrandCase titles ("HomeIoT") and
short titles that masking would cut to one word ("Home IOT") are judged whole; if the whole title reads as translated, the old verdict stands.
Native sentence-case phrases ("Persona standard") and words shared with the target language ("Status", "Export") are not held.

## Short English on non-Latin pages
On a Hindi, Arabic, Russian, Japanese or Chinese page (any page whose language isn't written in Latin letters), up to three Latin-script words
that are all English dictionary words ("technical • impatient", "casual • calm") are untranslated English: two hard facts, the script and the
dictionary, so the models' scattered guesses on two words don't matter. Names and brands are left alone (a phrase where every word is
capitalised only counts when it is plain interface wording such as "Settings").
Title-case English made of dictionary words ("Inventory Management", "Home IOT") is untranslated too, and Latin loanwords ("Home", "email")
are not excused on such a page; built-in names and brands (Apple Music, WhatsApp, Google) still count as names.
Other Latin-letter text on such a page (a session title such as "Wisight Mapping", a BrandCase title such as "HomeIoT") is listed as *unclear* ("Name or title?")
and is never counted as translated because of the text around it or because the rest of the page is translated. Lowercase account IDs
("jeffadmin", "vasu.k") are counted as names. Text flagged for its English wording keeps the English label even when two models guess
another language, unless every word is also a word of that language ("Service client" stays French).
A warning that rests on hard evidence like this is **confirmed** when no model reads the target language and two read some other language,
even if they name different ones, so *Confirmed warnings only* no longer moves it to Unclear.

## Short words and look-alike languages
Short strings such as "active", "archive", "contact" or "menu" are valid in several languages, so three models agreeing proves nothing.
One such word on its own is shown as *unclear* (never as untranslated) unless it contains clearly English wording. A **phrase** of two words
is different: when two models agree on the same other language and none of its words is one the target language also claims, it is untranslated
("Order History", "Eliminar todo"), while "Archives actives" on a French page stays safe. An English claim that rests on accented letters
("Pläne", "Privé", "Görsel") doesn't count as a vote. The language label is taken from function-word evidence, not from the model with the loudest guess. The "source" for comparison is only the page's English / `x-default`
alternate, never another translation. Details are in `src/guard.js`, `src/lexicon.js` and `test/hardneg.mjs`.

## English that the models can't place
Two or three cognate-heavy words ("Enthusiastic, decisive", "Aggressive, Defensive, Professional") are too short for any statistical model.
`src/english.js` adds dictionary evidence: a word that is everyday English (SCOWL) and **not** a word of the target language is English-only
("decisive" on a French page), while words both languages share ("impatient", "service", "menu") stay neutral. A phrase is flagged when its
English-only words make up at least half of it and none of its words belongs only to the target. A single word needs 9+ letters and tinyld's
agreement. Word lists exist for fr, de, es, it, pt and nl (`npm run wordlists` regenerates `src/wordlists.js`); other languages fall back to tinyld.

On an **English** page the same dictionary works the other way: text whose words are all everyday English ("Command Center", "Rubrics",
"Analyzing conversation transcript") is English, even when the models can't agree on two or three words. Short words must be English
ones, so "Analyse de la conversation" is still flagged.

## Lone words: read with their section
A single word with no sentence around it ("Empathie" alone in a card) is too short for the models. When it stays unclear, it is read with
its section: the nearest container whose other text is long enough (80+ letters). If that text is clearly in the page's language, the word
is counted as translated. It never is when the word is plain English on a non-English page ("Settings" in a German menu) or when two models
read it as another language.

## Dates
Dates written with month names ("10. Nov. 2026", "Nov 10, 2026", "10 de noviembre de 2026") are formatted values and are ignored, like numeric
dates. With *Format hints* on, a date whose month name is English and not also the page language's ("Dec 3" on a German page) gets a hint.

## Names
People, places and brands read the same in every language, so they are neither translated nor untranslated. They get a verdict of their own
(*name*): counted in the popup ("5 names"), never highlighted, never counted as unclear, and they don't change the score. A name is recognised
from the built-in lists in `src/names.js` (given names, surnames, cities, brands; about 13,000 given names and 13,000 surnames from 70 locales are generated into `src/namelists.js`, with ordinary words such as "Will" or "Grace" left out, plus common Malay names), or because it is shaped like one (capitalised words that are
not ordinary vocabulary) **and** the models cannot agree on any language for it, which is what names look like to a detector. Interface
vocabulary such as "Order History" or "Wish List" is a *label*, not a name, and is still checked. German pages don't use the shape rule
(German capitalises every noun). A single unknown capitalised word stays *unclear*.

## Repeated strings: one item, every place it appears
The same text with the same verdict is listed once, with **×N**. Capitals count: "Truecost" and "TrueCost" are two rows, so each spelling stays visible. Click it to go to the first place; click it again, or use **‹ ›** under it
(**Copy 2 of 3**), to move between the copies. Coming back to an item resumes at the copy you were on. The page marks the copy you jumped to
for a few seconds (one at a time, also when you click quickly). The score, the counts and the toolbar badge still count every copy, so
grouping changes only how the list reads.

## Context: where each string sits
Every item says what it is and where: *button · Navigation “Main menu”*, *placeholder · Form “Newsletter” › field “Email”*,
*button · Main › “Blue shirt”* (the heading of its own card or section, never a neighbouring one), plus the text just before and after it.
CSV and HTML exports carry this for every copy (new columns are added at the end, after the original eight).

## Ignore that learns
Ignore still adds the exact text to this site's list. It also remembers what the text looked like and where it was. Three similar Ignores make a rule:
- the same text ignored on two sites → ignored on all sites;
- three different texts of one narrow shape on a site → that shape is ignored there: codes (`SKU-1234`), versions (`v2.4.1`), abbreviations,
  BrandCase names (`HubSpot`), `@handles`, ™ names, identifiers (`user_name`);
- three different texts in the same page slot → text in that slot is ignored there (`span.user-name`, `[data-testid="sku"]`). A slot is the
  element's own class or test id, never a container further up (`div.card` would cover the whole card).

Broad shapes (a capitalised word, two capitalised words) are never learned: they would also hide real untranslated labels. The popup says
what it learned, with **Undo**; Settings → *Ignore & marked lists* lists the rules with **Remove**, and a removed rule is never learned again. Skipped
texts show as an *auto-ignored* chip. *Learn from Ignore* switches it off. The ignore-list export (version 2) includes the rules.

## Unclear: mark it untranslated, or ignore it
Each row under **Unclear** has two buttons. **Untranslated** says the text is untranslated: every copy (capitals ignored, so "Truecost" also
covers "TrueCost") moves to **Untranslated**, is highlighted and counted in the score, with the reason *Marked untranslated by you*. It stays
there on every later check of the site, whatever the models say. **Ignore** works as before: never flag the text. The latest choice wins, so
marking an ignored text takes it off the ignore list and the other way round. A marked row under Untranslated has **Unmark**, which hands
the text back to the models. Settings → *Ignore & marked lists* shows the marked texts for this site and for all sites (edit or delete
lines there), and the list export and import carry them.

## Live updates
With *Live* on, text that appears or changes after the check is checked as well, usually within a third of a second. Changes are
collected for 0.25 s and checked together, and never wait longer than 0.8 s, so pages with a ticking clock or live counters
("Zuletzt aktualisiert …", "vor 3 Sekunden") are updated too. Before, every tick restarted the wait, and new text on such pages was only
checked once the page went quiet. *Page's own language* is re-detected when the `<html lang>` attribute changes or a larger amount of
text changes (an interface switch), not on every small change.

Spelling, layout and the +35% stretch test were removed in 2.0.6, before release. Settings saved by an earlier build that still ask for them
change nothing.

## Checking a site automatically
Settings → *This site* → *Check … automatically* asks Chrome for access to that one site (one prompt) and then checks every page you open there.
The choice is saved first and the background worker finishes the setup, so it also works if Chrome closes the popup while it shows the prompt.

## After updating the extension
Chrome keeps the previous version's page script running in tabs that were already open, and its highlights stay on the page. Every check
(and *Clear*) now removes marks left by older copies, so the page only shows what the current check found. Reloading the tab is still the cleanest start.
2.0.6 marks the page under new names (`tc2-…`, `data-tc2-*`): a 2.0.5 copy still running in a tab used to sweep away the new highlights on
every live update. From 2.0.6 on, a copy whose extension was reloaded stops by itself.

## PDFs
Open a PDF in the browser and click the toolbar icon → **Check PDF**. The file is downloaded by the extension, read with pdf.js and checked
with the same pipeline. Clicking an issue jumps to its page and copies the snippet so you can press Ctrl+F. Scanned (image-only) PDFs have no text to check.
Local `file://` PDFs need "Allow access to file URLs" on the extension's details page, and Chrome also needs the `file:///*` host permission
to let the extension read the file: the first local PDF asks for it once (optional permission, nothing extra at install).

## Layout
- `background.js` – service worker: the language models (loaded once for the whole browser).
- `content.js` – small page-side scanner. `pdfcheck.js` + `vendor/` – PDF reader (pdf.js, Apache-2.0).
- `popup.html` / `panel.html` + `popup.js` – popup and side panel (same code). `learn.js` – ignore-list learning (from `src/learn.js`).
- `src/` – sources. `npm install && npm run build` rebuilds; `npm test` runs the checks; `test/e2e/` drives a real Chromium.
