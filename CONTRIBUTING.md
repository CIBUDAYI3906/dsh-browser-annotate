# Contributing

## 开发

```sh
node --check index.js
node --check client.js
node scripts/preflight.mjs
```

`client.js` 是手写在 ModuleLoader 里的客户端 bundle，注入到访问页面的 `guestAnnotate` 必须保持自包含（只能使用 window/document）。

## PR 前

- [ ] `index.js` 与 `client.js` 语法检查通过；
- [ ] `node scripts/preflight.mjs` 通过；
- [ ] 改了选择逻辑的话，写清楚验证方式（页面、手势、结果）；
- [ ] 不要夹带无关重构。

## 发布（维护者）

```sh
npm version patch
npm run preflight
npm publish --access public
```
