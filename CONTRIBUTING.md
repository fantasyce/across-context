# Contributing

Thanks for helping improve Across Context.

## Development

```bash
npm test
bash scripts/check.sh
```

The project has no runtime npm dependencies. Please keep new functionality
small, local-first, and covered by tests.

## Pull Requests

- Keep changes focused.
- Add or update tests for behavior changes.
- Do not commit private paths, tokens, credentials, screenshots, or local vault contents.
- Run `bash scripts/check.sh` before opening a PR.

## Memory Safety

Across Context is designed for automatic agent memory. Any change that affects
memory writes should preserve these principles:

- reject secrets before writing
- avoid duplicate records
- keep memory short and durable
- keep the default vault local

