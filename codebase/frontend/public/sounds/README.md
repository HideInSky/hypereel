# Sound library

Ready-made sounds people can add to a story (rain, crowd, city street...). Each entry in
`library.json` points to an audio file in this folder:

```json
{ "id": "rain-street", "label": "Rain on a street", "file": "rain-street.mp3", "seconds": 30, "license": "CC0", "credit": "Name of the author", "source": "https://..." }
```

Only add sounds you are allowed to redistribute in an MIT-licensed repo, such as CC0
(public domain) sounds, and record where each one came from. Loopable sounds work best,
since a layer can repeat across the whole story.

To add sounds, download them into one folder and run, from `codebase/backend`:

```bash
npm run import-sounds -- ~/Downloads/hypereel-sounds --license CC0
```

It cuts each file to at most 60 s, matches loudness, converts it to MP3 here and adds an
entry to `library.json`. Freesound file names (`<id>__<author>__<title>.wav`) fill in the
credit and source link automatically; check the labels afterwards.
