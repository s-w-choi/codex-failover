---
name: "npm install regression report"
about: "Report npm client/runtime install failures (arborist/reify errors, install crashes)"
title: "npm install -g fails with TypeError in arborist"
labels: ["bug", "npm", "installation"]
---

## Summary
Briefly describe what failed and what command you ran.

## Environment
- OS: <!-- e.g. macOS 15.4 (Darwin 25.4.0) -->
- Node: <!-- e.g. v24.0.0 -->
- npm: <!-- e.g. 11.3.0 -->
- Package: <!-- e.g. @sungwon_choi/codex-failover@0.0.3 -->
- Install scope: <!-- global / local -->

## Reproduction steps
```bash
nvm use <version>
npm install -g <package>
```

## Expected
What should have happened?

## Actual
What actually happened? Include:
- Full error message
- npm log file path
- Whether `--force` changed the outcome

## Evidence
Paste key log lines (or full log snippet).

```text
<paste log excerpt here>
```

## Notes
- If you saw deprecation warnings, mention them here (they may be non-blocking).
- If downgrade/alternate npm version changes behavior, please list the successful and failed version matrix.
