# 10. Node.js runtime metrics

> Part of the [PBS Exporter specification](../SPEC.md). See the index for the
> spec-driven-development workflow and the meaning of **[offline-ok]** / **[needs-pbs]**.

| ID | Requirement | Verify |
|----|-------------|--------|
| REQ-NODE-1 | Default Node.js process/runtime metrics (`process_*`, `nodejs_*`) are exposed alongside the PBS metrics. | `/metrics` output contains `process_cpu_seconds_total` and `nodejs_eventloop_lag_seconds`. **[offline-ok]** |
| REQ-NODE-2 | Default metrics are collected on a persistent registry (registered once at startup), not rebuilt per scrape. | Two consecutive scrapes both show `process_start_time_seconds` with the same value. **[offline-ok]** |
