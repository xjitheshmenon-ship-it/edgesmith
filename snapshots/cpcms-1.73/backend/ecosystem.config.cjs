// PM2 process file — `pm2 start ecosystem.config.cjs` on the VPS
module.exports = {
  apps: [{
    name: "cpcms",
    cwd: __dirname,
    script: "src/server.js",
    env: { NODE_ENV: "production" },
    max_memory_restart: "300M",
  }],
};
