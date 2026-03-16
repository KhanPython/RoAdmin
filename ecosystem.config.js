const path = require("path");

module.exports = {
  apps: [
    {
      name: "RoAdmin",
      script: "src/index.js",
      cwd: path.resolve(__dirname),
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