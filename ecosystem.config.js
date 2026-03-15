module.exports = {
  apps: [
    {
      name: "RoAdmin",
      script: "src/index.js",
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "300M",
      restart_delay: 3000,
      max_restarts: 5,
      time: true,
      merge_logs: true,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
