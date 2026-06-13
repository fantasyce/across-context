# Contributing

Thanks for helping improve Across Context.

## Development

```bash
npm test
bash scripts/check.sh
npm pack --dry-run --cache /tmp/across-context-npm-cache
```

The project has no runtime npm dependencies. Please keep new functionality
small, local-first, and covered by tests.

## Pull Requests

- Keep changes focused.
- Add or update tests for behavior changes.
- Do not commit private paths, tokens, credentials, screenshots, or local vault contents.
- Preserve the host-plugin boundary: managed runtime code belongs under
  `~/.across/plugins/across-context`, the executable wrapper belongs at
  `~/.across/bin/across-context`, and durable memory belongs under
  `~/.across/data/across-context`.
- Do not generate or commit plugin manifests, status output, fixtures, or
  documentation that point packaged hosts at `npm link`, a source checkout, or
  `~/Documents/projects/...` unless the path is explicitly documented as a
  developer-only override.
- Run `bash scripts/check.sh` before opening a PR.

## Memory Safety

Across Context is designed for automatic agent memory. Any change that affects
memory writes should preserve these principles:

- reject secrets before writing
- avoid duplicate records
- keep memory short and durable
- keep the default vault local
