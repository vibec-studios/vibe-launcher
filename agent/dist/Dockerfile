# syntax=docker/dockerfile:1
ARG BIN_SOURCE=build

FROM rust:1-trixie AS build
WORKDIR /src
COPY . .
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/cargo-target \
    CARGO_TARGET_DIR=/cargo-target cargo build --release --locked --manifest-path agent/Cargo.toml --bin vibe-agent \
    && install -D -m 755 /cargo-target/release/vibe-agent /out/vibe-agent

FROM scratch AS bin-build
COPY --from=build /out/vibe-agent /vibe-agent

FROM scratch AS bin-prebuilt
ARG TARGETPLATFORM
COPY .docker-bin/${TARGETPLATFORM}/vibe-agent /vibe-agent

FROM bin-${BIN_SOURCE} AS bin

FROM debian:trixie-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tini tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 vibe-agent \
    && useradd --system --uid 10001 --gid 10001 --home-dir /data --no-create-home --shell /usr/sbin/nologin vibe-agent \
    && mkdir -p /data \
    && chown vibe-agent:vibe-agent /data
COPY --from=bin --chmod=755 /vibe-agent /usr/local/bin/vibe-agent
ENV VIBE_AGENT_DATA_DIR=/data \
    VIBE_AGENT_PORT=25580 \
    VIBE_AGENT_BIND=0.0.0.0
VOLUME ["/data"]
EXPOSE 25580/tcp 25565/tcp
USER 10001:10001
WORKDIR /data
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD ["vibe-agent", "status"]
ENTRYPOINT ["/usr/bin/tini", "--", "vibe-agent"]
CMD ["run"]
