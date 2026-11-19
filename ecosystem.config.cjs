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
      // Au boot, l'interface docker0 (HOST=172.17.0.1) peut ne pas encore exister :
      // on espace les relances pour laisser Docker démarrer avant que PM2 n'abandonne.
      restart_delay: 5000,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
