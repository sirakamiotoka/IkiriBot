# Node.js の公式イメージをベースにする
FROM node:18

# Python とビルドツールをインストール
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    ffmpeg \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

# 作業ディレクトリを作成して設定
WORKDIR /app

# package.json と package-lock.json をコピー
COPY package*.json ./

# 依存関係をインストール
RUN rm -rf node_modules package-lock.json

RUN npm install

# pm2をグローバルインストール（プロセスマネージャ）
# RUN npm install pm2 -g

# ソースコードをすべてコピー
COPY . .

CMD ["npm", "start"]
