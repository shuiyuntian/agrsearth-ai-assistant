# CSS 隔离测试夹具

`css-fixture-a` 与 `css-fixture-b` 是纯构建/生命周期测试包，不是实际业务插件，禁止注册、提测或发布。

两包故意使用相同的 `.shared-card`、`.shared-overlay`、CSS 变量和 keyframes 名称，仅颜色与包 ID 不同。平台仓本地 Playwright 套件只伺服两包 `dist`，验证不同加载顺序、body 弹层、停用/恢复和销毁互不污染。
