# Scholarium 回归测试

## 两层测试与发布闸门

- **L1（结构级）**：bundle 正则、分类器、路由表、纯函数与静态契约。现有
  `node tests/run.js` 和 Agent Canvas 广泛回归主要属于这一层。L1 用于快速定位
  回归，但不再单独授权发布。
- **L2（端到端）**：测试名带 `[L2]`，文件名必须是 `l2-*.test.js`；使用真实
  输入文件走实际 Bridge/执行器，最后断言产物存在且内容正确。

发布判据只运行 L2：

```powershell
node tools/run-release-l2.js
```

`682/0` 或 Agent Canvas 的广泛回归数字只能说明 L1 稳定；没有 L2 全绿不得写
“可发布”。常规开发仍应同时运行下面的完整回归。

```
node tests/run.js
```

无需 `npm install`，无 `package.json`，不联网。**每次改动 `main.js` 前后各跑一次。**

## 为什么用这种写法

仓库里目前没有 TypeScript 源码和构建链，只有一个 36k 行的构建产物 `main.js`。
所以测试的做法是：按函数签名在 bundle 里定位实现 → 大括号配对取出函数体 →
在隔离环境里 eval。**测的是真正会发布的那份代码**，不是重写的副本。

将来 bundle 从 TypeScript 重新构建时，只需把 `harness.js` 的提取层换成正常
`import`，下面的断言可以原样保留。

## 文件

| 文件 | 覆盖内容 |
|---|---|
| `harness.js` | 函数提取、沙箱、断言、测试运行器 |
| `bundle-integrity.test.js` | 语法、顶层命名碰撞、类方法重名 |
| `radar-scoring.test.js` | 评分权重归一化、证据 rubric、画像指纹 |
| `metadata.test.js` | 出版社元数据、层级标签、受控词表、全文清洗 |
| `project-profile.test.js` | 课题画像 v2 的 frontmatter 往返与合并 |

## 这套测试抓到过的真实 bug

1. **`xr` 命名碰撞** — 新加的辅助函数与 bundle 里已有的 sRGB 线性化函数同名。
   同作用域下后声明静默覆盖前声明，主题对比度计算被破坏。`node --check` 无法发现。
2. **受控词表解析全空** — 正则里 `$` 在 `m` 标志下匹配行尾，惰性分组立刻以空内容
   满足。代码块被正确剥离，但三个列表全是空的。
3. **引号转义逐次累积** — 写入用 `JSON.stringify` 转义，读取只剥外层引号不反转义。
   假设文本里只要有一个双引号，每保存一次就多一层反斜杠，永久劣化。

前两个都是"语法正确但行为错误"，这正是纯手工补丁 bundle 最危险的失败模式。

## 加新测试

```js
const { sandbox, describe, it, assert } = require("./harness");

const S = sandbox({
  fns: ["je"],                       // 顶层 function 声明
  vars: ["Vr"],                      // 顶层 var 声明
  methods: { slugTag: ["t"] },       // 类方法 -> 方法名: [形参名]
});

describe("我的模块", () => {
  it("做了该做的事", () => {
    assert.eq(S.slugTag("A B"), "a-b");
  });
});
```

`methods` 里的形参名必须和 bundle 里**一模一样**（构建产物的形参名是压缩过的，
如 `t`、`e`、`s`）。签名变了测试会立刻报 `signature not found`，这是预期行为——
它在提醒你函数被改了。
