# World Studio

Orientation is in HANDOFF.md. The engine contract for games is engine/API.md.

## Web and desktop parity

World Studio runs two ways: in a browser (`npm run dev`) and as the macOS Electron app (`desktop/`, `World Studio.app`). Every change must work in both. Before finishing any change to this repo, invoke the `parity` skill (`.claude/skills/parity/SKILL.md`), check the change against its list of differences, verify both sides, and end with its parity line.

The one exception is the in-app agent: if your system prompt says the World Studio harness started you to edit a single `games/<slug>/` folder, skip this section.
