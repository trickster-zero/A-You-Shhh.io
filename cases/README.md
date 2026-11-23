# Case interview practice

Run cases from your own casebook as a mock interview. The app ships with no case content.
You import a PDF you own; it is read in your browser and stored on this device only.

## Import a casebook

1. Open `cases/index.html` on the site (it must be served over http(s), not opened as a file).
2. Under **Import a casebook**, choose your PDF.
3. **Interviewer guidance column**: leave on *Detect automatically*. If your casebook puts the
   interviewer notes (Answer, Hint, Transition) in a coloured side column and detection gets it wrong,
   pick *Right column* or *Left column* and import again.
4. The import report lists the cases found and any warnings, such as a missing prompt or a question
   with no answer. The parser never guesses: anything it can't find is left empty and listed here.

What the parser looks for (case-insensitive):

| Piece | Text it expects |
|---|---|
| Case start | `Case 10` or `Case 10: TITLE` |
| Title | the rest of the Case line, or an ALL CAPS line next to it |
| Industry and type | a subtitle line `Industry \| Type` |
| Prompt | a `Prompt` heading |
| Clarifying facts | `Clarifying Information`, then numbered `question? answer` pairs |
| Questions | `Question N:` |
| Guidance per question | `Answer`, `Hint`, bulleted or numbered figures (`Label: value`), `Transition` |
| Exhibits | a page that starts with `Exhibit N` (shown as an image) |
| Other | `Behavioral Question`, `Recommendation`, `Recap` or `Teaching` |

Slide-style casebooks are handled too:

- a running header such as `01 | CASE: TITLE` (also letter-spaced, like `C A S E`) starts a case
- `Question 1 (any note)` and later pages for the same question (`Question 1 Calculations`)
- guidance headings such as `Exhibit or Question Guidance:`, `Question 2 Guidance:`, `Best candidates:`
- `Provide if asked:` lists become figures you can mark as given on request
- `Framework Guidance:` and `How to Move Forward:` become the framework hint
- other named stages (`BRAINSTORMING`, `OTHER OPTIONS`) become extra steps with their own names
- `CONCLUSION` gives the question that leads into the recommendation; `Risks:` and `Next Steps:` join it
- an `INTERVIEWER FEEDBACK FORM` page ends the case
- clarifying facts written as `Topic: fact` as well as `question? answer`

If your casebook uses different words, edit the patterns in `HEADINGS` at the top of `js/parser.js`.

## Tag a case

Some things aren't in the PDF text, so you set them once per case. The form opens the first time you
start an untagged case, and **Tags** in the case list reopens it.

- **Difficulty, math, creativity**: 1 to 3 each. Required.
- **Numbers given on request**: tick each figure the interviewer hands over only when asked (the gray
  rows in most casebooks). During the case these appear only when you ask for them by name. Figures
  you leave unticked stay hidden until the debrief. Values are blurred in the form; tick *Show the
  values* if you don't mind spoilers.
- **Exhibit descriptions** (optional): read aloud when the exhibit appears.
- **Recap** (optional): only shown if the PDF has none.

## During a case

Intro → framework → each question → behavioral (optional) → recommendation → debrief.
Type clarifying questions and data requests; anything not in the case gets
"That isn't in the case materials." In practice mode each hint costs 1 point. **Skip case** reveals
everything and records no score.

## Your data

- Cases, tags and progress live in this browser's localStorage. The PDF itself is kept in IndexedDB
  so exhibit pages can be drawn later. Nothing is uploaded.
- **Export progress** saves a JSON file with case IDs, completed or skipped status, scores and dates.
  It contains no case text. **Import progress** merges a saved file back in.
- **Delete all case data** clears everything from this browser.

## Tests

Open `cases/index.html?test`, or run `node cases/tests/tests.js`. The tests use a fictional case
built in code; no PDFs are needed.
