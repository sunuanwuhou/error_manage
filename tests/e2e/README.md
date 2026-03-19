# Playwright E2E Smoke

这里放项目级的 E2E 冒烟测试。

## 运行

```bash
npm install
npm run test:e2e:install
npm run test:e2e
```

如果本地已经有服务在跑，可以直接指向现有地址：

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npm run test:e2e
```

## 约定

- 用 `tests/e2e` 作为统一目录。
- 优先写覆盖主流程的冒烟测试，再补更细的业务分支。
- 尽量使用 `getByRole`、`getByText`、`getByPlaceholder` 这类稳定选择器。
- 测试里不要依赖浏览器上一次运行留下的状态。
- 有共享状态的页面，默认按串行执行。
- 默认由 Playwright 自己先 `build` 再起一个生产态服务，默认端口是 `3100`，避免误命中手工调试用的 `3000`。
