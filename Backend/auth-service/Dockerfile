FROM node:18-alpine

WORKDIR /usr/src/app

COPY auth-service/package*.json ./
RUN npm install

COPY auth-service/src ./src
COPY shared ./src/shared

EXPOSE 3002

CMD ["npm", "start"]
