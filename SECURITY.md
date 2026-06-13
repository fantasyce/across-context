# Security Policy

## Reporting Security Issues

Please do not open a public issue for sensitive security reports. Use GitHub
private vulnerability reporting when it is available for this repository.

If private reporting is not available yet, open a minimal public issue that says
you have a security report to share, without including secrets, exploit details,
tokens, credentials, or private user data.

## Local-First Model

Across Context stores memory locally by default under
`~/.across/data/across-context`.
The package does not provide cloud sync and does not send vault contents to a
hosted service.

When installed as a host plugin, runtime code should live under
`~/.across/plugins/across-context`, the executable wrapper should live at
`~/.across/bin/across-context`, and generated manifests should describe those
managed paths. Packaged hosts should not point at `npm link`, a development
checkout, or `~/Documents/projects/...` unless the user explicitly selected a
developer override.

## Sensitive Data

The memory policy engine rejects common secret-like patterns before writing.
Users and contributors should still avoid storing:

- API keys
- tokens
- passwords
- cookies
- credentials
- private screenshots
- large logs with personal or production data

Release-candidate changes should run `bash scripts/check.sh`,
`npm pack --dry-run --cache /tmp/across-context-npm-cache`, and the repository
Security workflow before publication.
