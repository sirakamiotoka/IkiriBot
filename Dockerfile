FROM node:18

RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    ffmpeg \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

RUN rm -rf node_modules package-lock.json
RUN npm install

COPY . .

RUN npm install pm2 -g

EXPOSE 3000

CMD ["pm2-runtime", "start", "npm", "--", "start"]
