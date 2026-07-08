FROM node:18-alpine
WORKDIR /usr/src/app
COPY tenant-service/package*.json ./
RUN npm install
COPY tenant-service/src ./src
COPY shared ./src/shared
EXPOSE 3003
CMD ["npm", "start"]