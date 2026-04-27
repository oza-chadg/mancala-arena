FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY package*.json ./
RUN npm ci --omit=dev

COPY public ./public
COPY src ./src

USER node

EXPOSE 8080

CMD ["npm", "start"]
