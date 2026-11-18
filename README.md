# Translation Check 2.0.5

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

## Checking a site automatically
Settings → *This site* → *Check … automatically* asks Chrome for access to that one site (one prompt) and then checks every page you open there.
The choice is saved first and the background worker finishes the setup, so it also works if Chrome closes the popup while it shows the prompt.

## After updating the extension
Chrome keeps the previous version's page script running in tabs that were already open, and its highlights stay on the page. Every check
(and *Clear*) now removes marks left by older copies, so the page only shows what the current check found. Reloading the tab is still the cleanest start.

## PDFs
Open a PDF in the browser and click the toolbar icon → **Check PDF**. The file is downloaded by the extension, read with pdf.js and checked
with the same pipeline. Clicking an issue jumps to its page and copies the snippet so you can press Ctrl+F. Scanned (image-only) PDFs have no text to check.
Local `file://` PDFs need "Allow access to file URLs" on the extension's details page, and Chrome also needs the `file:///*` host permission
to let the extension read the file: the first local PDF asks for it once (optional permission, nothing extra at install).

## Layout
- `background.js` – service worker: the language models (loaded once for the whole browser).
- `content.js` – small page-side scanner. `pdfcheck.js` + `vendor/` – PDF reader (pdf.js, Apache-2.0).
- `popup.html` / `panel.html` + `popup.js` – popup and side panel (same code).
- `src/` – sources. `npm install && npm run build` rebuilds; `npm test` runs the checks; `test/e2e/` drives a real Chromium.
