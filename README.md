# Translation Check 2.0.7

A Chrome extension for localization QA. It checks whether a web page, or a PDF open in the browser, is fully in the language you expect,
and highlights the text that isn't: leftover English on a German page, Danish on a Dutch page, a translation key such as
`checkout.button.save` instead of real text. It is built for developers and testers reviewing multilingual web applications in context.

Everything runs locally in the browser. No page text is sent anywhere.

## Installing
1. Open `chrome://extensions` and switch on **Developer mode**.
2. Click **Load unpacked** and choose this folder.
3. Pin **Translation Check** to the toolbar.

Requires Chrome 114 or later (or another Chromium browser of the same version).

## Using it
1. Open the page you want to review and click the toolbar icon (or open the side panel with the panel button, so it stays open).
2. Under **Page should be in**, pick the target language, or keep **Page's own language**.
3. Click **Check page**.

The popup shows a score (the share of the page's text that is in the target language) and lists the findings in tabs:

| Tab | What it lists |
|---|---|
| **Untranslated** | Text in another language than the target. Highlighted in yellow with a red wavy underline on the page. |
| **Unclear** | Text the models can't judge with confidence (very short text, names and titles, words shared by several languages), always with a reason. An orange wavy underline on the page. |
| **Broken** | Leaked translation keys (`checkout.button.save`), unfilled placeholders (`{{name}}`, `%s`, `{0}`), `undefined`/`NaN`, `[object Object]` and missing-translation markers. Shown only when something is found. |
| **Ignored** | Names, codes and IDs, technical terms, dates and times, and what you ignored, each with its reason. What you ignored is listed first and has **Restore**, which takes it off the ignore list and puts it back in the tab it came from. Shown when something was ignored. |
| **Format** | Date and time formats that don't fit the language (always checked), and number and price formats (with *Format hints* on). Shown when something is found. |

Click a row to scroll to it on the page; **‹ ›** step through the list. Each row shows:
- **where the text is**: *button · Navigation “Main menu”*, *table cell · Table › “Projektgesundheitsübersicht”*, plus the text just before and after it;
- **how the three models voted**: three dots (red: another language, green: the target, grey: no answer) and a ✓ when at least two agree;
- **why it was flagged**: *Looks like English text*, *Name or title? Two language models read it as English*, *Identical to the source-language page*, and so on.

Chips under the score summarise the check: the language checked, how many names and codes were skipped, and whether live updates are on.

### Coverage: nothing is skipped silently
Every text item the check finds ends up in exactly one category, and the line under the chips counts them:
*71 scanned · 33 translated · 7 not translated · 13 unclear · 18 ignored*. If the numbers didn't add up, something would have been
skipped. **Ignored** covers names, codes and IDs, technical terms, dates and times (their format is checked under Format), your ignore
list and rules learned from it; each is exported with its reason. A legend above the list shows what the underlines on the page mean.

### On the page
Untranslated text keeps its yellow highlight and red wavy underline; unclear text gets an orange wavy underline (with *Mark unclear text*,
on by default). The wavy underlines are only on the page: the popup's legend shows the same colours as plain dots, like the tabs.

With *Card on underlined text* (Settings › On the page, on by default) pointing at underlined text shows a small card with the reason
and how many models read another language, and you can act there:
- **OK** closes the card. Nothing else changes: the text keeps its underline, its tab and the counts.
- **Not translated** (unclear text): listed as untranslated on every check of the site.
- **Unmark** (text you marked as untranslated): undoes your mark, back to **Unclear** (or to what the models said).
- **Ignore**: the text is put on this site's ignore list and moves to the **Ignored** tab (*Ignored by you*, with what the models read).

Ignoring never makes text *translated*. The Translated count only counts text in the page's language, and text the models read as
untranslated still counts against the percentage after you ignore it: it is still English on the page, it just isn't listed as a problem.
The decision goes into the same lists as the popup's buttons, the page is checked again, and an open popup or side panel follows.
With the card switched off, decide with the buttons on each row in the popup; switching it on or off applies to the checked page at once.

Tab counts are rows in the list (the same text in several places is one row, ×N), the same number the **‹ ›** navigator steps through;
the big numbers next to the score count every place on the page.

### Repeated text
The same text with the same verdict is one row, marked **×N**. Click it again (or use **‹ ›** under it, *Copy 2 of 3*) to visit each place it
appears; returning to a row resumes at the copy you were on. The page marks the copy you jumped to for a few seconds. Capitals count, so
"Truecost" and "TrueCost" are separate rows. The score and counts include every copy.

### Unclear text: mark it or ignore it
Every row under **Unclear** has two buttons:
- **Untranslated** moves every copy of the text (capitals ignored) to **Untranslated**, highlights it and counts it in the score, with the
  reason *Marked untranslated by you*. It stays untranslated on every later check of the site. **Unmark** on that row undoes it.
- **Ignore** stops the text from being flagged on this site. Rows under Untranslated have **Ignore** too. Like **Ignore** on the page, it
  moves the text to the Ignored tab (with **Restore**) and never counts it as translated.

The latest choice wins: marking an ignored text removes it from the ignore list, and the other way round.

### Ignore that learns
Ignore remembers what the text looked like and where it was, and three similar Ignores make a rule:
- the same text ignored on two sites is ignored on all sites;
- three texts of one narrow shape on a site ignore that shape there: codes (`SKU-1234`), versions (`v2.4.1`), abbreviations, BrandCase
  names (`HubSpot`), `@handles`, ™ names, identifiers (`user_name`);
- three texts in the same page slot ignore that slot there (`span.user-name`, `[data-testid="sku"]`). A slot is the element's own class or
  test id, never a container further up.

Broad shapes such as "a capitalised word" are never learned, because they would also hide real untranslated labels. The popup says what it
learned, with **Undo**. *Learn from Ignore* in Settings switches learning off.

### Exports
- **CSV**: one row per finding, untranslated, unclear and ignored items alike (each with its reason, so the export matches the coverage
  count), with type, text, reason, detected language, model agreement, element type (*where*: tab, heading, table cell,
  badge, button, placeholder…), CSS selector, page, number of copies, context, surrounding text and every location. No field is left empty
  (*unknown* when no language could be named, *n/a* where a column doesn't apply) and no field contains a line break: several locations are
  separated by ` | `, one per copy in both *context* and *all locations*. Selectors are full paths from the nearest id (`#root > …`). For
  text you marked as untranslated, *reason* keeps the models' own reading too (*Marked untranslated by you; models: …*). Text alone in a table
  cell has the rest of its row as surrounding text, and its context names the column (*Table › column “Status”*).
- **Report**: the same as a standalone HTML page to share.
- **Ignore & marked lists** (Settings): export and import as JSON, including learned rules and marked texts, to share them with your team.

## Settings

| Group | Setting | What it does |
|---|---|---|
| Strictness | **Relaxed** | Assumes unclear text is translated. Fewest warnings. |
| | **Balanced** (default) | Assumes very short unclear text (one or two short words) is translated when the rest of the page clearly is. Longer unclear text is always listed. |
| | **Strict** | Lists everything unclear. |
| Detection | **Double-check with CLD3 + franc** | Two more language models review every warning. |
| | **Confirmed warnings only** | Shows only warnings that at least two models back. |
| | **Accept related languages** | Treats close relatives (Spanish/Portuguese, Danish/Norwegian) as the target. |
| On the page | **Placeholders & tooltips** | Also checks alt text, placeholders, titles and accessible labels. |
| | **Card on underlined text** | Shows a card with the reason and decision buttons when pointing at underlined text on the page (on by default). |
| | **Mark unclear text** | Underlines unclear text on the page in orange (on by default). |
| | **Live updates** | Checks text that appears or changes after the check. |
| | **Compare with source language** | Flags text identical to the page's English (`hreflang`) version. |
| | **Format hints** | Checks number and price formats. Date and time formats are checked on every scan. |
| This site | **Check site automatically** | Checks every page of the current site when it loads (asks for access to that one site). |
| | **Ignore & marked lists** | The ignore list and the marked-untranslated list, for this site and for all sites, editable one per line. |

## How detection works

### Three models vote
1. **Rules first.** Numbers, dates, durations, versions, URLs, e-mail addresses, codes, model and brand names are set aside before
   anything is judged.
2. **tinyld** proposes a verdict. **CLD3** (Google's detector, as WebAssembly) and **franc** vote independently. A model abstains only when
   it has no guess at all; an unconfident but correct guess still counts.
3. **Two models agreeing decides.** Two that read the target language clear the text; two that name the same other language flag it.
   Close relatives count as one answer (CLD3's "Norwegian" agrees with tinyld's "Danish"). A model that abstains or names an unrelated
   language is asked again head-to-head: *the target, or the page's source language?* That answer only backs up the dictionary and never
   counts as agreement on its own.
4. **Page-level evidence** comes last: the sentence around a short string, the section a lone word or two-word label sits in, the page's source-language
   version, and (in Balanced mode) the page as a whole for very short strings.

### Dictionaries and letters
- **English wording is evidence.** Text whose words are all everyday English, including plurals, endings and compounds ("integrations",
  "roleplay"), counts as English; on an English page it counts as translated even when the models can't place two or three words.
  Words that English shares with the target language ("service", "menu", "impatient") are neutral. Word lists exist for French, German,
  Spanish, Italian, Portuguese and Dutch.
- **Labels must fit the letters.** A language is not used as a label when the text has letters it lacks, or when a long word has none of
  the accents the language always uses ("Systeemconfiguratie" is not Czech).
- **Short and shared words.** "active", "archive", "contact" or "menu" exist in several languages, so a single such word is at most
  *unclear*. A two-word phrase is untranslated when two models agree on another language and none of its words also belongs to the target
  ("Order History" on a Spanish page), while "Archives actives" on a French page is fine.

### Pages in non-Latin scripts
On a Hindi, Arabic, Russian, Japanese or Chinese page, Latin-script text stands out by its letters alone:
- up to three English dictionary words ("technical • impatient", "Inventory Management") are **untranslated**;
- other Latin-script text, such as a project or session title ("Wisight Mapping", "HomeIoT"), is **unclear** (*Name or title?*) and is
  never counted as translated because of its surroundings;
- built-in names and brands (WhatsApp, Google) and lowercase account IDs ("jeffadmin") count as names.

### Titles on Latin-script pages
On a German, French, Danish… page, text that two models read as English and that is written like a title ("Skill Scout", "Wisight
Development") is listed as *Name or title?*. It is judged on its own text only, never cleared by its section or by the rest of the page, so
every copy gets the same verdict. A single unknown capitalised word ("Wisight", "Truecost") is held the same way when it sits in the same
column or set of cards as other titles. Native phrases ("Persona standard") and words the target language also uses ("Status", "Export")
are not held.

### Tooltips
Tooltip text is checked whether or not the tooltip is open:
- **Tooltips that exist only while open** (Radix / shadcn/ui and libraries built the same way): during a check, each tooltip button is
  focused for a moment, as a keyboard user would, its text is read and focus goes back. The text is listed as the button's tooltip, so it
  stays listed after the tooltip closes, and an open tooltip is not counted twice.
- **Tooltips hidden until hover** (a `role="tooltip"` box, the target of `aria-describedby`, `hidden group-hover:block` or `invisible`
  boxes): their text is checked while hidden and highlighted as soon as the tooltip opens. Clicking the row outlines what the tooltip
  belongs to. Hidden text that is not a tooltip (a closed tab, a template) is not checked.
- **Tooltip attributes**: `title`, `data-tooltip`, `data-tip`, `data-tippy-content` and Bootstrap's original-title, with *Placeholders &
  tooltips* on.

Buttons that open menus, accordions or dialogs (`aria-expanded`, `aria-haspopup`, `aria-controls`) and form fields are never focused.

### Names
People, places and brands read the same in every language, so they are neither translated nor untranslated. They are counted
(*5 names*), never highlighted, and don't affect the score. A name is recognised from built-in lists (about 13,000 given names and
13,000 surnames from 70 locales, cities, brands, common Malay names) or by its shape: capitalised words that are not ordinary vocabulary and
that the models can't agree on. Interface wording such as "Order History" is a label, not a name, and is still checked.

### Lists and table columns are judged together
Items in the same table column, or in the same repeated slot (cards, list items with the same element and class), are treated
consistently. When at least two of them, and 40% or more, are names or titles that are flagged or held for a decision, the others there that are
still unclear are held as well: never assumed translated or cleared by their section ("Smart Service Analytics", "Solan → Bhayla
Manufacturing Transition" in a column of English project names). A code-like name there that would otherwise be skipped ("Testproj123")
is listed as unclear (*Name or code?*). Text the models read as the page's language keeps its verdict, and a column of real codes
(`AB-1001`, `ZX-2002`) stays ignored. This uses only the page's own structure, so it works the same on any site.

### Status values
Status values ("Valid", "Completed", "In progress") come from the app's data and sit in badges, pills and table cells. A model can't place
one short word, and the target language's word list may know it as a loanword (German lists have "valid"), so they used to be assumed
translated. In a status slot (a badge or pill, `role="status"`, a table cell or definition value) a plain English status word on a page in
another Latin-script language is **untranslated** (*English status value*). Words the target language spells the same way are left alone
("Online", "Offline"; "Active" in French, "Error" in Spanish, "Open" in Dutch).

### Labels on tabs and buttons
A Title Case phrase on a tab, button, menu item, option or column header ("Knowledge Intelligence", "Document Repo") is interface text, not a
product name: when two models read it as English and at least one of its words is an English dictionary word, it is **untranslated**
(*English interface label*) without needing a manual mark. The same phrase in a table cell or a card title is still judged as a possible
name (*Name or title?*).

### Technical terms
Terms that stay in English in every interface (REST API, API, URL, JSON, OAuth, SSO, Webhook, SDK, GraphQL…) are set aside like codes and
counted under *skipped*, never listed as unclear. Add your own with **Ignore**.

### Dates and times
Dates are formatted values and are not judged as text, including ones with month names ("10. Nov. 2026", "10 de noviembre de 2026"). Their
format is checked on every scan and listed under **Format**:
- an English month name on a non-English page ("Dec 3" on a German page);
- English date order ("Nov 13, 2026") on a page whose language puts the day first ("13. Nov. 2026");
- 12-hour times ("08:38 PM") on a page whose language uses the 24-hour clock ("20:38");
- a date separator the language doesn't use ("13/11/2026" on a German page);
- dates written in different formats on the same page ("13/11/2026" next to "14.11.2026").

## Page's own language
Many apps switch their interface language without updating `<html lang>`. With **Page's own language** selected, the page's own text
decides as well: a page that declares English (or nothing) but whose longer text is mostly another language is checked in that language.
A page that declares another language keeps it, unless that language is essentially absent. With live
updates on, switching the app's interface language re-checks the page in the new language by itself.

## Live updates
With live updates off, text that appears in the first five seconds after a check (table rows and status badges loaded from the server) is
still checked, then the page is left alone.

With **Live updates** on, text that appears or changes after the check is checked too, usually within a third of a second. Changes are
collected for 0.25 s and checked together, and never wait more than 0.8 s, so pages with a ticking clock or live counters are kept up to
date. Only the changed parts are checked again. *Page's own language* is re-detected when `<html lang>` changes or a larger amount of text
changes, such as an interface language switch.

If the extension is reloaded or updated while a tab is open, the page script left in that tab stops by itself, and the next check removes
any highlights it left behind. Reloading the tab gives the cleanest start.

## Checking a site automatically
Settings → *This site* → **Check … automatically** asks Chrome for access to that one site and then checks every page you open there, with
live updates on. The choice is saved first and the background worker finishes the setup, so it also works if Chrome closes the popup while
the permission prompt is open.

## PDFs
Open a PDF in Chrome and click the toolbar icon → **Check PDF**. The file is read with pdf.js and checked the same way as a page. Clicking a
finding jumps to its page and copies the snippet so you can press Ctrl+F. Scanned (image-only) PDFs have no text to check.

Local `file://` PDFs need **Allow access to file URLs** on the extension's details page; the first local PDF also asks once for the
`file:///*` permission.

## Permissions
- `activeTab`, `scripting`: check the current tab when you click the icon.
- `storage`: settings, ignore lists, marked texts and learned rules.
- `sidePanel`: the side panel.
- Optional host permissions (`http`, `https`, `file`): asked for only when you turn on automatic checking for a site or check a local PDF.

## Project structure
| Path | Contents |
|---|---|
| `manifest.json` | Extension manifest (Manifest V3). |
| `background.js` | Service worker: the language models and dictionaries, loaded once for the whole browser. Built from `src/background.src.js`. |
| `content.js` | Page script: collects text, masks codes and names, asks the worker, highlights and lists results. Built from `src/content.src.js`. |
| `popup.html`, `panel.html`, `popup.js`, `popup.css` | Popup and side panel (same code; `panel.html` is generated). |
| `learn.js` | Ignore-list learning, built from `src/learn.js`. |
| `pdfcheck.js`, `vendor/` | PDF reader (pdf.js, Apache-2.0). |
| `src/` | Sources: `engine.js` (tinyld and rules), `verify.js` (CLD3/franc voting), `english.js` and `wordlists.js` (dictionaries), `names.js` and `namelists.js` (names), `context.js` (where text sits), `status.js` (status values and badges), `mask.js` (with the technical-term list), `rules.js`, `guard.js`, `scripts.js`, `alphabet.js`, `dates.js`. |
| `scripts/` | `build.mjs` (esbuild bundle) and `wordlists.mjs` (generates `src/wordlists.js`). |
| `test/` | Unit tests (Node + jsdom) and `test/e2e/` (Playwright in a real Chrome, with test pages in `test/e2e/site/`). |

## Development
```sh
npm install
npm run build        # bundles background.js, content.js, learn.js, pdfcheck.js and generates panel.html
npm test             # builds, then runs every unit suite
npm run wordlists    # regenerates src/wordlists.js (don't edit it by hand)
CHROME=/path/to/chrome python test/e2e/run.py     # real-browser checks; see test/e2e/README.md for the other suites
```
After changing anything in `src/`, run `npm test` and commit the built files with the sources.
