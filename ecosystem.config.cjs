// Configuration PM2 (fichier .cjs : le projet est en ESM, PM2 attend du CommonJS).
// Usage : pm2 startOrReload ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'hive-data-api',
      script: 'src/server.js',
      cwd: __dirname,
      instances: 1, // SQLite : une seule instance
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
