# Client Dockerfile (dev server)
FROM node:18-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY . .
EXPOSE 4200
CMD ["npm", "start"]
