# Contributing

Search [existing issues](https://github.com/gagexhill/grid-wallpaper/issues) before opening a new one. Discuss larger changes in the owning issue before starting. The [Code of Conduct](CODE_OF_CONDUCT.md) applies to all contributors.

## Set up

Install Git, the Node.js version in [.node-version](.node-version), Microsoft Edge on Windows, and [Gitleaks](https://github.com/gitleaks/gitleaks). From a clone, run:

```powershell
npm ci
git config core.hooksPath .githooks
```

## Check your change

Use the [local validation gates](OPERATIONS.md#validate) for your change. Browser and installer fixture tests cover different behavior from an installed Lively session. Record the display layout and Windows and Lively versions when validating native behavior.

## Pull requests

1. Branch from the current `origin/main`.
2. Describe the behavior change and link the owning issue. Use a closing keyword when its acceptance criteria are met.
3. List the local checks that passed and any installed checks still pending.
4. Update the relevant documentation when setup or behavior changes. Keep machine paths, personal information, and installed session files out of patches and logs.

[AGENTS.md](AGENTS.md) describes repository invariants. [OPERATIONS.md](OPERATIONS.md) owns the maintainer runbook.
