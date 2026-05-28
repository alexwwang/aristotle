FROM ghcr.io/anomalyco/opencode:latest

USER root

RUN apk add --no-cache \
    python3 \
    py3-pip \
    git \
    curl \
    bash \
    ca-certificates

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

WORKDIR /root

ENTRYPOINT ["opencode"]
