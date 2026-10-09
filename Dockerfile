FROM nginx:1.27-alpine

RUN rm /etc/nginx/conf.d/default.conf

COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY public/index.html /usr/share/nginx/html/index.html
COPY public/js/ /usr/share/nginx/html/js/
COPY extension/ignis-client.js extension/rest-client.js extension/capture-api.js /usr/share/nginx/html/js/

ENV IGNIS_UPSTREAM=https://10.5.0.134
ENV OBSIDIAN_REST_UPSTREAM=https://host.docker.internal:27124
ENV NGINX_ENVS=IGNIS_UPSTREAM,OBSIDIAN_REST_UPSTREAM

EXPOSE 80
