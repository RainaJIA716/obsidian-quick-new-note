# Quick New Note — community listing

Paste these into community.obsidian.md. Search (in the app and on the website)
only looks at the **name + short description**, so the short description is
written for search; About is written to convince.

## Short description (≤200)

Create a new note in a folder you pick from a header button menu of preset favorite folders, or choose any folder. Applies your Templater folder templates. Note location picker, works on mobile.

(194 chars)

Why this wording (checked against the 2026-11 registry with `search_rank.py`; app search needs every
word of the query somewhere in the name or short description, results sorted by downloads):

- Matches 27 of the 30 queries in `search-queries.txt`, e.g. "new note in folder", "create note in folder",
  "choose folder", "folder templates", "new note template", "new note button".
- For 7 of them fewer than 5 plugins match, so a new plugin can still show up in the top 5:
  "templater folder", "new note mobile", "preset folders", "favorite folders", "new note menu",
  "new note location", "quick new note".
- Not matched: "select folder", "default folder", "new file folder" — wording them in would read badly.

## About (≤1000, plain text)

The backend field is plain text: Markdown list markers and emphasis are not
rendered, so this is written as short paragraphs. Paste everything between the
lines.

---

Obsidian puts every new note in one default folder. If your notes live in several folders, you end up creating the note and then moving it, every time.

Quick New Note adds a "New note in…" button to the note header. It opens a menu of your own folders, in the order you set, with optional short aliases. Pick one and a new note is created right there and opened with the title selected, ready to type its name. The current note's folder is at the top of the menu, and "Other folder…" searches every folder in the vault.

If you use Templater folder templates, the new note gets the template set for that folder, or for the nearest parent folder, with Templater syntax processed. There is nothing to set up twice. Folders without a template get a blank note.

The same button works on phones and tablets, where the menu opens as a bottom sheet. Already using Quick Move? One click imports its folder list. The interface is in English and Chinese.

---

## Icon

`file-plus` (the same icon as the button), any color.

## Categories

1. Files (primary)
2. Interface

## Screenshots

- Desktop slot: `desktop-1200x800.png` (from `../hero.svg`)
- Mobile slot: `phone-900x1600.png` (from `phone.svg`)
