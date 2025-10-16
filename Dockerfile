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



# 2025-10-16 追加
RUN npm install @discordjs/voice@latest @discordjs/core@latest
RUN npm install @snazzah/davey
COPY . .
# PM2 インストール
RUN npm install pm2 -g

EXPOSE 3000

# index.jsを直接実行
# CMD ["node", "index.js"]

CMD ["pm2-runtime", "ecosystem.config.js"]
