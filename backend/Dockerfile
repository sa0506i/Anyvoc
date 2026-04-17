# Pinned base image so rebuilds months later reproduce bit-for-bit.
# Update this tag deliberately when you want the base to move forward.
FROM node:20.18.1-alpine3.20
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 8080
CMD ["node", "server.js"]