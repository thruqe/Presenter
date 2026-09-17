FROM oven/bun:latest

WORKDIR /app

COPY package.json bun.lock* ./

RUN bun install --frozen-lockfile --production

COPY src ./src
COPY public ./public
COPY db ./db

EXPOSE 1000

ENV PORT=1000
ENV NODE_ENV=production

CMD ["bun", "run", "src/index.ts"]
