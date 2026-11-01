FROM rust:1.99.1-slim-bookworm AS base
RUN apt-get update && apt-get install -y --no-install-recommends bash ca-certificates curl git jq pkg-config libssl-dev make && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace

FROM base AS tools
RUN rustup component add rustfmt clippy llvm-tools-preview
RUN cargo install --locked cargo-llvm-cov --version 0.9.1 \
    && cargo install --locked cargo-mutants --version 27.1.0 \
    && cargo install --locked cargo-deny --version 0.18.9 \
    && cargo install --locked cargo-watch --version 8.5.3

FROM base AS builder
COPY . .
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/workspace/target,sharing=locked \
    cargo build --locked --release -p ici-server && mkdir -p /out && cp target/release/ici-server target/release/ici-worker /out/

FROM debian:bookworm-slim AS production
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 app && useradd --uid 10001 --gid app --no-create-home app
COPY --from=builder /out/ici-server /usr/local/bin/ici-server
COPY --from=builder /out/ici-worker /usr/local/bin/ici-worker
USER 10001:10001
ENV BIND_ADDRESS=0.0.0.0:3000
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=2s --start-period=10s --retries=10 CMD curl --fail --silent http://127.0.0.1:3000/health || exit 1
ENTRYPOINT ["ici-server"]
