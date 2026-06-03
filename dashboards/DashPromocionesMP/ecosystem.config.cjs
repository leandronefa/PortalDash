module.exports = {
  apps: [
    {
      name: 'dash-promociones',
      script: 'server.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3005,
      },
    },
  ],
};
