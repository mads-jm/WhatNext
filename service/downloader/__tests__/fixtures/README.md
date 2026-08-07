# Backend-execution fixtures

Recorded stdout/stderr captured from real CLI runs, used by the
`*-backend.test.ts` suites to drive backends offline (no live binary). These are
**version-specific** — see the epic risk note on fixture drift.

Capture procedure (documented for refresh):
- yt-dlp: `yt-dlp -x --audio-format mp3 --progress --newline --print after_move:WHATNEXT_FILEPATH=%(filepath)s <url>`
  captured from yt-dlp 2024.08.06. The `WHATNEXT_FILEPATH=` sentinel prefix makes
  the final-path line unambiguous (the backend captures only lines starting with
  that marker), so an informational line can never be mistaken for the output path.
- spotDL: `spotdl download <url> --output <dir> --format mp3 --print-errors`
  and `spotdl save <url> --save-file -`, captured from spotDL 4.2.x.
  `spotdl-save-unreadable.stdout.txt` is the #56 failure mode: `save` exits 0
  but writes log lines instead of JSON, so there is no metadata to map.
- Spytify: `spytify --path <dir> --format mp3`, transcribed from a Spytify 1.10
  recording session (Windows-only PoC; format unverified across versions).

`.stdout.txt` / `.stderr.txt` files are split on newlines by `loadFixtureLines`.
`.json` files are parsed verbatim.
