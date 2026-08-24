FROM node:24-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NODE_ENV=production

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/crypto/package.json packages/crypto/package.json
COPY packages/adapters/package.json packages/adapters/package.json
COPY apps/api/package.json apps/api/package.json

RUN pnpm install --frozen-lockfile --filter @wotta/api...

COPY packages/shared packages/shared
COPY packages/crypto packages/crypto
COPY packages/adapters packages/adapters
COPY apps/api apps/api
COPY deployments deployments

WORKDIR /app/apps/api

CMD ["node", "--import", "tsx/esm", "src/server.ts"]
