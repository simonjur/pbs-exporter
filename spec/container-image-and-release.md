# 11. Container image & release

> Part of the [PBS Exporter specification](../SPEC.md). See the index for the
> spec-driven-development workflow and the meaning of **[offline-ok]** / **[needs-pbs]**.

The exporter ships as a container image published to the GitHub Container Registry
under `ghcr.io/simonjur/pbs-exporter-node`.

| ID | Requirement | Verify |
|----|-------------|--------|
| REQ-IMG-1 | A [`Dockerfile`](../Dockerfile) builds a Node.js 24 image that runs the exporter straight from TypeScript (no compile step); the runtime stage installs production dependencies only (`npm ci --omit=dev`), copies `src/` and `scripts/`, and runs `npm run build:fe` to assemble the status-UI frontend into `public/` (see `REQ-UI-6`). | `docker build -t pbs-exporter-node .` succeeds and the image contains `public/index.html`. **[offline-ok]** |
| REQ-IMG-2 | The image runs as the unprivileged `nobody` user (UID `65534`) and exposes port `10019`. | `Dockerfile` declares `USER 65534` and `EXPOSE 10019`; `docker run --rm pbs-exporter-node --version` prints the version line. **[offline-ok]** |
| REQ-IMG-3 | Build metadata (`PBS_BUILD_VERSION`, `PBS_BUILD_COMMIT`, `PBS_BUILD_TIME`) is injectable at build time via `--build-arg` and surfaced as env at runtime (consumed by `--version`). | `docker build --build-arg PBS_BUILD_VERSION=vX.Y.Z .` then `docker run` with `--version` reflects `vX.Y.Z`. **[offline-ok]** |
| REQ-IMG-4 | Published images are multi-arch, built and pushed as a single manifest list for `linux/amd64` and `linux/arm64`. | The release workflow's build step sets `platforms: linux/amd64,linux/arm64`; `docker buildx imagetools inspect ghcr.io/simonjur/pbs-exporter-node:alpha` lists both platforms. **[offline-ok]** |
| REQ-REL-1 | The [release workflow](../.github/workflows/release.yml) builds and pushes `ghcr.io/simonjur/pbs-exporter-node` on every push to `main` and on every `v*` tag. | Inspect `on.push.branches` (`main`) and `on.push.tags` (`v*`). **[offline-ok]** |
| REQ-REL-2 | A push to `main` publishes the `:alpha` tag. | Inspect the `docker/metadata-action` `tags` rule (`type=raw,value=alpha` enabled on `refs/heads/main`). **[offline-ok]** |
| REQ-REL-3 | A push of a `v*` tag publishes a `:v<version>` tag equal to the git tag name (e.g. `v1.2.3`). | Inspect the `docker/metadata-action` `tags` rule (`type=ref,event=tag`). **[offline-ok]** |
| REQ-REL-4 | [`docker-compose.yaml`](../docker-compose.yaml) references the published image `ghcr.io/simonjur/pbs-exporter-node:alpha`. | Inspect the compose `image:` field. **[offline-ok]** |
