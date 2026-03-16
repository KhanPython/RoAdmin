const path = require("path");

module.exports = {
  apps: [
    {
      name: "RoAdmin",
      script: "src/index.js",
      // Use the absolute path to ensure PM2 always knows where to write
      cwd: "/home/orazimbetov_jalaladdin1/RoAdmin", 
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "300M",
      restart_delay: 3000,
      max_restarts: 5,
      time: true,
      // Force log locations so your YAML script knows exactly where to look
      out_file: "./logs/out.log",
      error_file: "./logs/err.log",
      merge_logs: true, 
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};