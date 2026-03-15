module.exports = {
  apps: [
    {
      name: "RoAdmin",
      script: "src/index.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "300M",
      restart_delay: 3000,
      max_restarts: 5,
      time: true,
      merge_logs: true,
      out_file: "/home/orazimbetov_jalaladdin1/.pm2/logs/RoAdmin-out.log",
      error_file: "/home/orazimbetov_jalaladdin1/.pm2/logs/RoAdmin-error.log",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
