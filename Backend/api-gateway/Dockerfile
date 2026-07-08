FROM node:18-alpine

WORKDIR /usr/src/app

COPY api-gateway/package*.json ./
RUN npm install

COPY api-gateway/src ./src

EXPOSE 3000

CMD ["npm", "start"]
