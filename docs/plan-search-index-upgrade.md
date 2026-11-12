# 搜索与定位：精简升级方案

> 2026-11-12。用户问「能否用线性索引和图谱搜索提高搜索与定位的速度和准确度」。
> 本文每条都标 `文件:行`。**结论先说：线性索引已经有了，图谱寻址缺三样东西——都补得上，且不用引入新引擎。**

---

## 一、现状：已经有了什么（代码事实）

`search-index.ts`（762 行）已经是 **SQLite FTS5 + 中文 bigram 倒排索引**：

| 能力 | 事实 | 出处 |
|---|---|---|
| 倒排索引 | `CREATE VIRTUAL TABLE docs_fts USING fts5(tokens, tokenize='unicode61')` | `search-index.ts:308` |
| 中文分词 | 连续汉字 → 重叠 bigram（`支付专项` → `支付 付专 专项`） | `search-index.ts:95` `indexTokens()` |
| 查询侧同构 | 查询也转 bigram phrase | `search-index.ts:130-143` `matchExpression()` |
| 排序 | bm25 + 用户消息加权 1.8 | `search-index.ts:326` |
| 表结构 | `docs(session_id, message_id, seq, part_id, role, text, ts)` | `search-index.ts:292-301` |
| 分页取页 | `readChat(sessionId, beforeSeq?, maxRows?)` | `data/impl/session.ts:213-227` |
| 索引版本机制 | `SEARCH_INDEX_VERSION = 4`，口径一变即清库重建 | `search-index.ts:320` |

**所以「线性索引」不用引进 —— 它已经跑着了。** 真正缺的是下面三样。

---

## 二、三个真实缺口（都有出处）

### 缺口 1：索引表里没有 `turn` / `step` → 定位只能反推

- `docs` 表字段：`session_id, message_id, seq, part_id, role, text, ts` —— **没有 turn/step**（`search-index.ts:292-301`）
- 而 `RenderMessage` 上**有** `turn`(120) 和 `step`(147)（`mobile/projections/types.ts`）
- 结果：定位只能拿 `message_id` 查行、拿 `seq` 当游标；行被跨页合并后对不上，就退化成关键词模糊匹配

**这就是「图谱寻址」真正要补的那一格。**

### 缺口 2：单字查询走 `LIKE '%字%'`，用不上索引

代码注释自己写明（`search-index.ts:304-307`）：

> 单字查询走 LIKE（没有 bigram 可用），SQLite 的 `LIKE '%字%'` 用不上索引；但按 ts 倒序走索引、凑够 LIMIT 就停…常用字从 320ms 掉到几十毫秒

**「320ms」是代码注释里记录的实测值**，不是我的估算。现状是「靠 ts 倒序凑 LIMIT」缓解，不是真正解决。

### 缺口 3：`part_id` 语义与渲染端不一致

- 索引端写 `'answer'`（助手）/ `'body'`（用户）—— `host/search-text.ts:107,115`
- 渲染端只在 `answerSeq` 存在时才给 `data-part-id="answer"` —— `host/search-text.ts:103-104`
- 客户端拿它和 `flow[].partId`（真实 id）比 → **必然不相等**

**而 `docs` 表里已经有一列 `role`（`search-index.ts:298`）**，这个字段本来就是干这个的。

---

## 三、三处改动（对应三个缺口，不引入新引擎）

| # | 改什么 | 怎么改 | 工时 | 风险 |
|---|---|---|---|---|
| 1 | `docs` 表补 `turn` / `step` | schema 加两列 + `documentRows()` 填（数据就在 `RenderMessage` 上）+ 搜索结果多回 `path:{turn,step,role}` + `SEARCH_INDEX_VERSION` → 5 触发重建 | 1.5 h | 低（版本机制已有） |
| 2 | 单字也进 FTS tokens | `indexTokens()` 在 bigram 之外把单字一并输出；查询侧单字不用再走 LIKE 兜底 | 1 h | 中（索引体积涨，需量一下） |
| 3 | 删除 `part_id` 的语义挪用 | 搜索返回改用已有的 `role` 列；`part_id` 只留真实 part id 或空 | 0.5 h | 低 |

**合计 3 h**，与定位重写（5.2 h）**可并行**，但**建议先做 1** —— 定位重写的第 1 步依赖它。

---

## 四、做完能拿到什么（可测，不吹）

| 指标 | 现在 | 改动后 | 怎么量 |
|---|---|---|---|
| 单字查询耗时 | 约 320 ms（代码注释记录） | 目标 < 50 ms | 宿主日志计时，用同一个字跑 10 次取中位 |
| 深历史命中的取页次数 | 未测 | ≤ 2 | 探针统计 `mobile.readChat` 调用数 |
| `partId` 语义错配 | 存在（必然不相等） | 消除 | 单测：`path.role` 与渲染行 `kind` 一致 |
| 行被跨页合并后能否定位 | 靠关键词模糊兜底 | 按 `turn:step` 直接查表 | 场景测试 |

> 「约 320 ms」引自代码注释的实测记录；「< 50 ms」是**目标值，尚未验证**。

---

## 五、明确不做（避免过度设计）

| 不做 | 理由（基于事实） |
|---|---|
| 图数据库 / GraphRAG | `docs` 表已在 SQLite 里，加两列就能表达层级；单会话行数量级在内存 Map |
| 向量检索 | 定位是**确定性寻址**（已知 messageId / turn / step），不是语义相似 |
| 换搜索引擎（Meilisearch 等） | FTS5 + bigram 已覆盖中文二字词；换引擎的收益不抵运维成本 |

---

## 六、与「定位重写」的关系

```
本方案（3 h）          →  补数据：索引里有 turn/step/role
定位重写（5.2 h）      →  用数据：查表寻路替换 508 行反推逻辑
```

**两者是数据与消费的关系，不重复劳动。** 先做本方案的第 1 项（1.5 h），定位重写的「图谱寻路」才有依据。
