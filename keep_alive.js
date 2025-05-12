// keep_alive.js
const express = require('express');

const app = express();

// ルートにアクセスしたときのURLを返す
app.get('/', (req, res) => {
  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  res.send(`このページのURLは ${url} です`);
});

// Flask の run に相当する関数
function run() {
  const port = 8080;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server is running at http://localhost:${port}`);
  });
}

// Python の keep_alive に相当
function keepAlive() {
  run(); // Node.js では別スレッドにする必要なし
}

module.exports = keepAlive;
