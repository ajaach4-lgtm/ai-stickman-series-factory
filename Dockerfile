
FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    ffmpeg \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm install

COPY . .

RUN mkdir -p uploads public

ENV NODE_ENV=production

EXPOSE 3000

CMD ["npm", "start"]
