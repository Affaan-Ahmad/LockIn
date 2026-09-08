# Timetable fixtures

Captured from the university's published timetable on **7 September 2026**.

| | |
|---|---|
| Document | `Time-Table, FSC, Spring-2026` — FAST School of Computing |
| Spreadsheet id | `1ZQJqdArlwCS965uw4sbJrB6j8rEPfZerMT7X8qkXSzY` |
| Endpoint | `https://docs.google.com/spreadsheets/d/<id>/htmlview/sheet?headers=true&gid=<gid>` |
| Contact named in the sheet | `fahad.shahzad@nu.edu.pk` |

| File | Tab | gid |
|---|---|---|
| `monday.html` | Monday | 1882612924 |
| `tuesday.html` | Tuesday | 2029661410 |
| `wednesday.html` | Wednesday | 1634689132 |
| `thursday.html` | Thursday | 1622709969 |
| `friday.html` | Friday ONLINE | 1783333514 |

A sixth tab, `Welcome` (gid 1174567785), holds only a note saying the timetable
is published per day. It is not captured because it contains no schedule.

## What was kept, and what was removed

Each file is the `<style>` block followed by the `<table>`, **both verbatim**.
Only `<script>` blocks were removed — they are the tab switcher, about 47 KB per
file, and nothing in them is read by the parser.

Nothing else was reformatted, reordered or tidied. That matters, because the
parser's whole job is to survive the sheet exactly as its authors write it, and a
cleaned-up fixture would test a document that does not exist.

## Why `htmlview` and not CSV

`export?format=csv` returns **401** for this document: downloads are disabled for
viewers. The `gviz` endpoint does return values without credentials, and is the
obvious thing to reach for. It is the wrong thing, and the reason is the point of
the whole module:

> **A class's batch is stored only in its cell's background colour.**
> `OOP (CS-A)` and `DB (CS-A)` are the same section string. One is BS CS (2025)
> in room C-301, the other BS CS (2024) in C-409, and the legend in the first
> four rows is what tells them apart.

Any values-only source — the CSV export, `gviz`, or an `IMPORTRANGE` mirror
sheet — discards that and silently merges four intakes, which would show a
first-year student their seniors' timetable. `htmlview` is the only
credential-free endpoint that preserves both the background colour and the
merged-cell spans that carry each class's duration.

## Refreshing these fixtures

Re-fetch the same URLs and strip the `<script>` blocks. Expect churn: the
registrar edits this sheet during the semester, which is the reason the app syncs
it at all. The tests are written against *behaviour under irregularity* rather
than against counts, so a moved class should not break them — but the parse
should be re-checked when they are refreshed, and any newly unreadable cell will
appear in `diagnostics` rather than being silently dropped.

These HTML fixtures depend on the document staying link-viewable: if sharing is
revoked, `htmlview` returns the sign-in page instead. That dependency is the
reason the Sheets API path below exists, and why it is the one the app uses.
The HTML path is kept as a second, independent implementation that the
cross-source test checks the API against.

---

# Sheets API fixtures

Captured the same day with an API key, while the document was still publicly
readable. These pin the **credentialed** path, which is what the app will
actually use once the OAuth credential is in place.

| File | Contents |
|---|---|
| `tabs.sheets.json` | The tab listing: `sheets.properties(title,sheetId,hidden,index)` |
| `monday.sheets.json` | One full day, minified, with the exact field mask the client sends |

The field mask is the one thing worth copying verbatim, because it is what keeps
the response a sensible size — 310 KB rather than 1.1 MB:

```
sheets(properties(title,sheetId,hidden),merges,
       data(rowData(values(formattedValue,effectiveFormat/backgroundColor))))
```

## What the API showed that the HTML export hid

**The document has twelve tabs and shows six.** `htmlview` lists only the
visible ones, so scraping it silently misses the rest:

```
visible   Welcome, Monday, Tuesday, Wednesday, Thursday, Friday
HIDDEN    Monday (May 11), Tuesday (May 12), Sat (25 Apr),
          Sat (May 02), Sat (May 09), Saturday (Feb.14,2025)
```

Those are makeup sittings and days moved around holidays, kept long after they
happened — one of them from February 2025. `selectStandingWeek` therefore takes
only tabs that are **visible and whose title is exactly a weekday**, and
`classifyDayTab` reports the rest as `DATED_SITTING` rather than dropping them,
so a caller can decide what to do with a genuinely current one.

## Three things about the response that are not in the schema

Each was confirmed against the live document, and each is a silent bug if missed.

1. **A missing colour channel means zero.** Google omits zero-valued fields, so
   pure blue arrives as `{"blue": 1}` — no `red`, no `green`. Multiplying an
   absent channel gives `NaN`, and a cohort quietly stops matching the legend.
2. **Only a merge's anchor carries its content.** Every other cell in the range
   reports a white background and no value, so the `merges` array has to be
   applied to recover the text *and* the colour.
3. **Line breaks are the newline character**, doing the same job as `<br>` in
   the HTML export: separating two classes that share one merged cell.

Also worth knowing: the spreadsheet declares `timeZone: America/Los_Angeles`,
which is a default nobody changed. It is meaningless for a Pakistani university
and must not be used to interpret any time in the sheet.

## Keeping the two sources honest

`tests/unit/timetable-sheets.test.ts` parses Monday from **both** fixtures and
asserts the results are identical — every class, room, time, batch, colour,
status and note. The two paths share no extraction code, so that test is what
demonstrates the credentialed source can replace the public one without changing
a single entry.
