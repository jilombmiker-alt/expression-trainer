# 后端 P0 · 阶段 04：核心埋点基础

日期：2026-09-04。状态：事件采集与本地持久化已落地；运营看板、告警和完整漏斗仍待建设。

## 当前事件

| 事件 | 来源 | 主要字段 |
| --- | --- | --- |
| training_started | 服务器 | trainingId、schemaVersion |
| step_viewed | 客户端 | step |
| reading_completed | 客户端 | round、durationMs、endReason |
| microphone_permission_resolved | 客户端 | granted/denied/unavailable |
| asr_interrupted | 客户端 | 原因枚举 |
| asr_finished | 客户端 | 引擎枚举、durationMs |
| transcript_confirmed | 客户端 | round |
| coach_hint_shown | 客户端 | round；进入引导重练 |
| training_resumed | 客户端 | step |
| knowledge_generation_finished | 服务器 | 规则生成方式、耗时 |
| model_connection_tested | 服务器 | 成功/失败、厂商或错误码、成功耗时 |
| assessment_failed | 服务器 | attemptId、错误码 |
| assessment_finished | 服务器 | trainingId、attemptId、round、mode、规则版本、分项分、暂定/无效标志 |

客户端有 UUID、发生时间、schemaVersion、可用时的 trainingId；服务器写入内部 owner、收到时间、emitter。客户端时间和行为只能用于分析，不是防作弊事实。训练未注册前的页面事件允许 trainingId 为空。

## 传输和校验

POST /api/events：每批 1–20 条、最多 32KB；每访客每分钟最多 300 条事件。严格字段和枚举白名单，拒绝正文/Key 等任意字段，客户端不得上报 assessment_finished 等服务器成绩事件。引用训练编号必须属于当前访客。

浏览器队列仅在内存，最多 100 条，失败每 15 秒重试；同一事件编号服务端去重。刷新可能丢失尚未发送事件，不宣称完整无损采集。遥测失败不阻塞训练。当前没有逐字上传、音量帧上传或会话回放。

## 数据隐私

普通埋点不接收文章、转录、音频、Key、模型连接凭证、姓名或邮箱。评分所需正文和材料只在受访客权限保护的业务记录中；事件表仅存统计数据。现阶段业务记录和事件的删除入口、自动保存期限、用户告知与选择机制尚未完成，公开发布前必须补齐。

## 模型用量

语义结果将 OpenAI、Anthropic、Gemini 的 token 字段归一化；缺失保留未知，不当作零。Gemini total 以供应商实际返回为准，不强行覆盖隐藏推理等额外计数。当前不是账单审计，缓存计费、失败请求账单、语音计算费和存储费仍需补充。

## 后续看板

1. 流程：按训练编号聚合选题、BYOK、阅读、转录、评分、两轮完成，补充明确的训练完成事件、超时未完成判定和留存事件。
2. 成长：相同难度/文章版本/基准权重下，区分独立、引导和示例；不能用总分单一上涨证明成长。
3. 可靠性：首段转录延迟、评分 P50/P95、失败率、重试、并发队列、成本归属和报警。

这些看板本阶段只定义指标方向，没有生成运营界面或接入外部统计服务。
