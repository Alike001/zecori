FROM node:24.14.0-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod

FROM node:24.14.0-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd --system --gid 10001 zecathon && useradd --system --uid 10001 --gid zecathon --home-dir /app zecathon
COPY --from=build --chown=zecathon:zecathon /app/node_modules ./node_modules
COPY --from=build --chown=zecathon:zecathon /app/dist ./dist
COPY --from=build --chown=zecathon:zecathon /app/server ./server
COPY --from=build --chown=zecathon:zecathon /app/src ./src
COPY --from=build --chown=zecathon:zecathon /app/scripts ./scripts
COPY --from=build --chown=zecathon:zecathon /app/package.json ./package.json
COPY --chown=zecathon:zecathon docker/entrypoint.sh /usr/local/bin/zecathon-entrypoint
RUN chmod 0555 /usr/local/bin/zecathon-entrypoint
EXPOSE 8787
ENTRYPOINT ["zecathon-entrypoint"]
CMD ["node", "--experimental-strip-types", "server/app-server.ts"]
