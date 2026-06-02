# Security Policy

## Reporting Security Issues

Please do not open a public issue for sensitive security reports. Use GitHub
private vulnerability reporting when it is available for this repository.

If private reporting is not available yet, open a minimal public issue that says
you have a security report to share, without including secrets, exploit details,
tokens, credentials, or private user data.

## Local-First Model

Across Context stores memory locally by default under `~/.across-context`.
The package does not provide cloud sync and does not send vault contents to a
hosted service.

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

