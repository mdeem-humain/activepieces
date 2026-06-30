# Redact Input Strings Example Engine Plugin

This example engine plugin redacts configured string patterns from piece action and trigger `propsValue` before the piece callback runs. It is intentionally small and uses only the public engine plugin contract from `@activepieces/core-execution`.

Build it before loading it:

```bash
npm run build --prefix packages/plugins/example/redact-input-strings
```

Example `AP_ENGINE_PLUGINS` value for an installed package:

```json
[
  {
    "packageName": "@activepieces/engine-plugin-redact-input-strings",
    "exportName": "enginePlugin",
    "failurePolicy": "fail-startup",
    "config": {
      "pieceNames": ["@activepieces/piece-ai"],
      "rules": [
        {
          "name": "us-ssn",
          "pattern": "\\b\\d{3}-\\d{2}-\\d{4}\\b",
          "flags": "i"
        }
      ]
    }
  }
]
```

For local development, build this package and use its absolute path as `packageName` while `AP_ENVIRONMENT=development`.

With the config above, a prompt such as `Summarize SSN 123-45-6789` is passed to the AI piece as `Summarize SSN REDACTED`.

The plugin adds the `g` flag when it is omitted. Only `g`, `i`, `m`, `s`, `u`, and `y` are accepted. Regular expressions are compiled while the engine loads the plugin, so malformed config fails at startup instead of during a flow run.

Regular expression config can itself be sensitive when it encodes customer-specific identifiers or private matching rules. Do not log the full `AP_ENGINE_PLUGINS` value or the plugin `config` object.

Only rule names and counts are logged. Matched values and full inputs are never logged.

Regexp-based redaction is defense in depth for piece inputs, not a full DLP system. It does not classify every form of PII and cannot guarantee coverage for unconfigured or obfuscated sensitive data.
