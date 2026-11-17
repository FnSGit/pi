# Changelog (fork: dev/blunt)

This file holds the notes for the changes that live only on this fork, not upstream.
`CHANGELOG.md` stays byte-identical to `upstream/main`, so merging upstream never
conflicts on it. Keep fork entries here instead of editing `CHANGELOG.md`.

The entries below are not shown by "What's New": it parses only released `## [x.y.z]`
sections of `CHANGELOG.md`.

## [Unreleased]

### Added

- The footer now shows the current session id on its own line, so a session can be located for troubleshooting without running `/session`
- The footer renders each extension status on its own line, so a long status such as a git-status path and branch does not push the token stats off the row
- The `hideFooterPwd` setting drops the footer's pwd (cwd and git branch) line, for extensions that already render that row via `ctx.ui.setStatus()`
- `skill://<name>` URIs in the read tool: `skill://pdf-tools` reads a skill's `SKILL.md` and `skill://pdf-tools/references/formats.md` reads a file bundled with the skill, so the model no longer needs the absolute path.
- Embedded `/skill:<name>` tokens: a skill command anywhere in a message expands in place, with the surrounding text becoming the arguments.

### Changed

- The system prompt now tells the model to load a skill's file with the read tool via its `skill://<name>` URI before acting, and not to claim to follow a skill whose file it has not loaded.
- Skill descriptions in the system prompt are truncated to a bounded preview that cuts at a sentence or word boundary.
- Same-name skill collisions keep the later skill under a `<label>/<name>` alias (for example `project/foo`) instead of dropping it, so no skill silently disappears.
- An unknown `/skill:<name>` now returns an error listing the available skills instead of passing the text through verbatim.
