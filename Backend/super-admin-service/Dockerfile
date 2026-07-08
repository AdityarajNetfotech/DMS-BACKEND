FROM node:18-alpine
WORKDIR /usr/src/app
COPY super-admin-service/package*.json ./
RUN npm install
COPY super-admin-service/src ./src
COPY shared ./src/shared
EXPOSE 3001
CMD ["npm", "start"]