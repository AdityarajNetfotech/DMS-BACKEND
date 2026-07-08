FROM node:18-alpine
WORKDIR /usr/src/app
COPY manager-service/package*.json ./
RUN npm install
COPY manager-service/src ./src
COPY shared ./src/shared
EXPOSE 3006
CMD ["npm", "start"]
