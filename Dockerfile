FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
ENV API_PROXY_TARGET=http://host.docker.internal:8080
ENV NGINX_ENVSUBST_FILTER=API_PROXY_TARGET
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist/client /usr/share/nginx/html
EXPOSE 80
