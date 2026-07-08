FROM node:18-alpine
WORKDIR /usr/src/app
COPY user-service/package*.json ./
RUN npm install
COPY user-service/src ./src
COPY shared ./src/shared
EXPOSE 3004
CMD ["npm", "start"]