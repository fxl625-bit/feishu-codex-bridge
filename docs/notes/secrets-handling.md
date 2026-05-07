# Secrets Handling

- Real Feishu credentials live in the local `.env.local` file only.
- `.env.local` is ignored by git and must not be copied into committed files.
- `ALLOWED_OPEN_IDS`, `FEISHU_ENCRYPT_KEY`, and `FEISHU_VERIFICATION_TOKEN` still need to be filled after the Feishu app is configured.
