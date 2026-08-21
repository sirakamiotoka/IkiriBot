module.exports = {
  apps: [
    {
      name: "ikiribot",
      script: "index.js",

      autorestart: true,
      watch: false,

      restart_delay: 1500,

      exp_backoff_restart_delay: 500,

      max_restarts: 20,
      min_uptime: "10s",

      max_memory_restart: "700M",

      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
