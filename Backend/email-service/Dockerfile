FROM node:18-alpine
WORKDIR /usr/src/app
COPY email-service/package*.json ./
RUN npm install
COPY email-service/src ./src
COPY shared ./src/shared
EXPOSE 3005
CMD ["npm", "start"]