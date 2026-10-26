# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (npm install statt npm ci für mehr Flexibilität)
RUN npm install

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM nginx:alpine

# Copy custom nginx config
# Copy custom nginx config template
COPY nginx.conf /etc/nginx/templates/default.conf.template

# Copy built application
COPY --from=builder /app/build /usr/share/nginx/html

# Expose port
EXPOSE 80

# Start nginx with envsubst to replace variables in the template
# NGINX_RESOLVER = erster Nameserver aus /etc/resolv.conf (IPv6 in eckigen Klammern), damit nginx die Backend-Adresse neu auflösen kann
CMD ["/bin/sh", "-c", "export NGINX_RESOLVER=$(awk '/^nameserver/{ip=$2; if (ip ~ /:/) ip=\"[\" ip \"]\"; print ip; exit}' /etc/resolv.conf) && envsubst '${BACKEND_URL} ${NGINX_RESOLVER}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
