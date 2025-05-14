# Node.js の公式イメージをベースにする
FROM node:18

# Python とビルドツールをインストール
RUN apt-get update && apt-get install -y python3 build-essential

# 作業ディレクトリを作成して設定
WORKDIR /app

# package.json と package-lock.json をコピー
COPY package*.json ./

# 依存関係をインストール
RUN npm ci

# アプリケーションを起動するコマンドを指定
CMD ["npm", "start"]
