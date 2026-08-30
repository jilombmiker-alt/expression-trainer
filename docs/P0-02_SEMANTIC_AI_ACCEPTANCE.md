# P0 第 2 阶段技术开发文档｜真实语义模型与评分验收

> 配套文档：`PRD_P0_EXPRESSION_TRAINER.md`、`P0_TECHNICAL_ADAPTATION.md`、AI Agent 产品 Vibe Coding 通用技术栈手册。

## 一、阶段目标

- 区分同义转述、遗漏、冲突、答非所问和关键词堆砌。
- 模型只给逐知识点证据；零分门槛和权重评分由确定性代码执行。
- 无真实模型时继续体验，但明确显示“本地暂定”。

## 二、技术适配摘要

- 延续 Python 服务，使用 OpenAI-compatible 接口，不绑定单一厂商 SDK。
- Prompt、请求校验、输出解析和评分相互分离。
- 本阶段代码可离线 mock；真实模型冒烟是最终验收门槛。

## 三、技术栈与模型

- `services/semantic_service.py`：标准库 HTTP 调用、超时、有限重试和结构校验。
- 模型厂商与模型名尚未由产品经理确认。
- 浏览器本地语义规则仅作降级，不冒充真实模型。

## 四、环境与配置

- 必填：`EXPRESSION_LLM_API_KEY`、`EXPRESSION_LLM_MODEL`。
- 可选：`EXPRESSION_LLM_BASE_URL`、`EXPRESSION_LLM_TIMEOUT_SECONDS`、`EXPRESSION_LLM_RETRIES`。
- Key 只在后端环境读取；`.env` 被忽略，只提交 `.env.example`。

## 五、项目结构

- `services/prompts/semantic_assessment_v1.txt`：版本化 Prompt。
- `services/semantic_service.py`：模型服务和校验。
- `web/semantic-evaluator.js`：本地降级与模型证据适配。
- `web/scoring-model.js`：零分门槛和权重计算。

## 六、数据、资产与状态

- 输入：原文、中心思想、3–5 个概念组和用户转录。
- 输出：每个概念的 `matched / missing / conflict`、原转录证据、置信度和关系证据。
- 元数据：模型、Prompt 版本、耗时、尝试次数和 Token 用量；不记录 Key 或完整文档日志。

## 七、API / 工具设计

- `GET /api/semantic/health`：只报告是否配置、模型名和 Prompt 版本。
- `POST /api/semantic/evaluate`：受控请求和严格响应。
- 失败使用统一错误结构；鉴权失败不可重试，超时、限流和服务错误按规则有限重试。

## 八、Prompt 设计

- Prompt 角色：只做证据判定，不直接评分，不补充来源外知识。
- 强制 JSON；概念名称必须与输入一致。
- `matched` 和 `conflict` 的证据必须是转录稿中的原文片段，否则输出判为无效并重试。

## 九、验收界面或纵向切片

- 分析页标记“真实模型证据”或“本地暂定”。
- AI 教练最多指出三个问题，先引导用户重说，不直接提供标准答案。
- 无模型或失败时不阻塞用户查看本地分析。

## 十、测试要求

- mock：请求限制、证据归属、非 JSON、遗漏概念、重复概念、无 Key、重试和安全元数据。
- 真实冒烟：同义、遗漏、冲突、关键词堆砌和答非所问各至少 1 条。
- 记录真实模型、耗时、Token、首次格式合规和重试后合规。

## 十一、验收清单

- [ ] 同义表达可匹配，不要求逐字复述。
- [ ] 关键词堆砌不会自动判对。
- [ ] 相反表达标记冲突。
- [ ] 每个判断能看到转录证据。
- [ ] 无模型时明确为暂定。
- [ ] 至少一条真实输入完成真实模型端到端链路。

## 十二、风险与待确认项

- 当前没有真实模型 Key，因此真实质量、网络、限流、成本和延迟仍未验证。
- 模型厂商、模型名和成本上限需要产品经理决定。
- 评分阈值仍属于 P0 可配置规则，需根据真人样本校准。

## 十三、交接给下一阶段

- 已就绪：接口、Prompt v1、结构校验、有限重试、降级和 4 项模型合约测试。
- 阻塞项：配置真实 Key 并完成冒烟；完成前不得宣布 AI 语义能力通过验收。
