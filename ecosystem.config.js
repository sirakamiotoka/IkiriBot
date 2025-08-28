module.exports = {
  apps: [
    {
      name: "ikiribot",
      script: "index.js",   
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 2000,
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};

/*
module.exports = {
  apps: [
    {
      name: "app",
      script: "npm",
      args: "start",
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 5000, // 再起動間隔(ミリ秒)
    },
  ],
};
*/
