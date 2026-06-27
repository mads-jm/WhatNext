# Backend-execution fixtures

Recorded stdout/stderr captured from real CLI runs, used by the
`*-backend.test.ts` suites to drive backends offline (no live binary). These are
**version-specific** — see the epic risk note on fixture drift.

Capture procedure (documented for refresh):
- yt-dlp: `yt-dlp -x --audio-format mp3 --progress --newline --print after_move:filepath <url>`
  captured from yt-dlp 2024.08.06.
- spotDL: `spotdl download <url> --output <dir> --format mp3 --print-errors`
  and `spotdl save <url> --save-file -`, captured from spotDL 4.2.x.
- Spytify: `spytify --path <dir> --format mp3`, transcribed from a Spytify 1.10
  recording session (Windows-only PoC; format unverified across versions).

`.stdout.txt` / `.stderr.txt` files are split on newlines by `loadFixtureLines`.
`.json` files are parsed verbatim.
