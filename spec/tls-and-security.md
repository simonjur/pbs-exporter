# 9. TLS & security

> Part of the [PBS Exporter specification](../SPEC.md). See the index for the
> spec-driven-development workflow and the meaning of **[offline-ok]** / **[needs-pbs]**.

| ID | Requirement | Verify |
|----|-------------|--------|
| REQ-SEC-1 | TLS minimum version is 1.2. | Code review of the undici `Agent` config. **[offline-ok]** |
| REQ-SEC-2 | When `insecure` is true, server certificate verification is disabled (per-client, not process-global). | With a self-signed PBS and `PBS_INSECURE=true`, scrape succeeds. **[needs-pbs]** |
| REQ-SEC-3 | User-controlled values (e.g. the resolved target) are stripped of CR/LF before being logged, preventing log injection. | `?target=` containing `%0a` does not produce a multi-line debug log. **[offline-ok]** |
| REQ-SEC-4 | The resolved target/endpoint URL is validated by `validateUrl()` before any HTTP request: it must be a parseable absolute URL using an `http:` or `https:` scheme. Any other scheme (`file:`, `gopher:`, …) or an unparseable URL is rejected, mitigating SSRF. A configured `endpoint` that fails validation is a fatal startup error; an invalid `?target=` returns HTTP 400 without performing a scrape. As defence-in-depth, the exporter re-validates the fully-resolved request URL with `validateUrl()` immediately before each `fetch` and passes the resulting `URL` object (not a raw string) to `fetch`. | `GET /metrics?target=file:///etc/passwd` returns HTTP 400 and makes no request. **[offline-ok]** |
