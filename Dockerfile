# syntax=docker/dockerfile:1
# Open Tabletop server (multiplayer): Node HTTP + WebSocket, PGlite in /data (or DATABASE_URL for Postgres).
# Private miniatures (docs/development/deployment.md#private-miniatures):
#   runtime (preferred): docker run -e MINI_LIBRARY_SOURCES=github:Owner/miniature-viewer@main -e MINI_LIBRARY_TOKEN=… image
#   build time (bundled into dist/, visible to anyone who can load the site):
#     docker build --build-arg MINI_LIBRARY=github:Owner/miniature-viewer@main --secret id=mini_library_token,env=GH_TOKEN .
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG MINI_LIBRARY=""
# the token is a BuildKit secret: mounted for this step only, never stored in a layer or the image
RUN --mount=type=secret,id=mini_library_token \
    if [ -n "$MINI_LIBRARY" ]; then MINI_LIBRARY_TOKEN="$(cat /run/secrets/mini_library_token 2>/dev/null)" npx tsx tools/miniatures/import-library.ts "$MINI_LIBRARY"; fi
RUN npx vite build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
COPY package.json package-lock.json ./
# npm start runs the TypeScript server through tsx, so keep the installed tree from the build stage.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
COPY tsconfig.json ./
VOLUME /data
EXPOSE 8787
HEALTHCHECK CMD node -e "fetch('http://localhost:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]
