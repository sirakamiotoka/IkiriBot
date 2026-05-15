module.exports = {
  apps: [
    {
      name: "ikiribot",
      script: "index.js",   
      autorestart: true,
      watch: false,
      
      restart_delay: 1500,
     //2026-05-15 stop_exit_codes: [0, 2],
      max_restarts: 500,
      min_uptime: 600000,
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
