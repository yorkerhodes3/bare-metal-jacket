FROM node:24-alpine

RUN addgroup -S -g 10001 app \
    && adduser -S -D -H -u 10001 -G app app

WORKDIR /app
COPY --chown=app:app server.mjs /app/server.mjs

USER 10001:10001
ENV PORT=9180
EXPOSE 9180

ENTRYPOINT ["node", "/app/server.mjs"]
