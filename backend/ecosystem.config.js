// PM2 process configuration — for the Hetzner production deployment.
// On Render the Docker CMD (`node app.js`) is used instead.
module.exports = {
  apps: [
    {
      name: 'cpcms-backend',
      script: 'app.js',
      cwd: '/var/www/cpcms/backend',
      instances: 2,
      exec_mode: 'cluster',
      watch: false,
      max_memory_restart: '1G',
      env: { NODE_ENV: 'production', PORT: 3001 },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
  ],
};
