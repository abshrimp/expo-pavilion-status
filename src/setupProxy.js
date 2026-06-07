// 開発用（npm start）のみ有効。CRA開発サーバーはPHPを実行しないため、
// /reserve.php へのリクエストだけ、別途立てたPHPサーバーへ転送する。
// 本番ビルド（npm run build）には影響しない。
//
// 使い方:
//   1) 別ターミナルで PHP を起動:  php -S 127.0.0.1:8000 -t public
//   2) npm start
//   （PHPのポートを変える場合は PHP_DEV_URL=http://127.0.0.1:9000 npm start）
const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function (app) {
    app.use(
        '/reserve.php',
        createProxyMiddleware({
            target: process.env.PHP_DEV_URL || 'http://127.0.0.1:8000',
            changeOrigin: true,
        })
    );
};
