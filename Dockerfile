# First stage: Build the frontend
FROM --platform=$BUILDPLATFORM node:22 AS build
WORKDIR /workspace

COPY ./web-pixi/package.json ./web-pixi/package-lock.json ./
RUN npm install
COPY ./web-pixi .
RUN npm run build

FROM nginx:stable-alpine
WORKDIR /usr/share/nginx/html
COPY --from=build /workspace/dist .
