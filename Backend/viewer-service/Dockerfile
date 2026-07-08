FROM node:18-alpine

WORKDIR /usr/src/app

COPY viewer-service/package*.json ./

RUN npm install

COPY viewer-service/src ./src
COPY shared ./src/shared

EXPOSE 3007

CMD ["npm", "start"]
