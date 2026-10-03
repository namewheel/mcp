# NameWheel MCP server, local mode (stdio). Picks, teams, wheel links and draw
# checks run inside this container; certified draws use NAMEWHEEL_API_KEY.
#   docker build -t namewheel-mcp .
#   docker run -i --rm namewheel-mcp
#   docker run -i --rm -e NAMEWHEEL_API_KEY=nw_live_... namewheel-mcp
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY widget ./widget
COPY assets ./assets
USER node
ENTRYPOINT ["node", "dist/stdio.js"]
