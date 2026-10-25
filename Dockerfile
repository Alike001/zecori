FROM node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8 AS build
ARG VCS_REF
LABEL org.opencontainers.image.revision=$VCS_REF \
      org.opencontainers.image.title="Zecathon cross-chain app"
WORKDIR /app
RUN printf '%s' "$VCS_REF" | grep -Eq '^[0-9a-f]{40}$' || { echo 'VCS_REF must be the exact 40-character Git revision' >&2; exit 1; }
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod

FROM node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8 AS runtime
ARG VCS_REF
LABEL org.opencontainers.image.revision=$VCS_REF \
      org.opencontainers.image.title="Zecathon cross-chain app"
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update \
 && apt-get upgrade -y \
 && rm -rf /var/lib/apt/lists/* /usr/local/lib/node_modules/npm /opt/yarn-v* \
 && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg
RUN groupadd --system --gid 10001 zecathon && useradd --system --uid 10001 --gid zecathon --home-dir /app zecathon
COPY --from=build --chown=zecathon:zecathon /app/node_modules ./node_modules
COPY --from=build --chown=zecathon:zecathon /app/dist ./dist
COPY --from=build --chown=zecathon:zecathon /app/server ./server
COPY --from=build --chown=zecathon:zecathon /app/src ./src
COPY --from=build --chown=zecathon:zecathon /app/scripts ./scripts
COPY --from=build --chown=zecathon:zecathon /app/package.json ./package.json
COPY --chown=zecathon:zecathon docker/entrypoint.sh /usr/local/bin/zecathon-entrypoint
COPY --chown=zecathon:zecathon docker/runtime-command.sh /usr/local/bin/zecathon-runtime-command
RUN find dist server src scripts -type d -exec chmod 0555 {} + \
 && find dist server src scripts -type f -exec chmod 0444 {} + \
 && chmod 0444 package.json \
 && chmod 0555 /usr/local/bin/zecathon-entrypoint /usr/local/bin/zecathon-runtime-command
USER 10001:10001
EXPOSE 8787
ENTRYPOINT ["zecathon-entrypoint"]
CMD ["node", "--experimental-strip-types", "server/app-server.ts"]
