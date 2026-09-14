# 后端第 5 阶段｜埋点汇总、个人查询与运营权限

## 交付范围

在现有 Python 同源 API + SQLite 的访客隔离、两轮作答、服务端评分基础上实现汇总层。不是另外搭一个只展示假数字的前端后台，不引入收费统计服务。个人可在现有设置页查看；运营全站汇总提供受保护 API 和本机查询命令，本阶段未另建可视化运营大屏。

## 接口契约

| 接口 | 权限 | 内容 |
| --- | --- | --- |
| GET /api/analytics/summary?days=7 | 当前访客 HttpOnly Cookie | 仅本人的训练/作答/事件汇总 |
| GET /api/privacy | 当前访客 | optionalAnalytics，默认 false |
| POST /api/privacy | 当前访客，同源 | JSON 布尔 optionalAnalytics；错误类型 400 |
| POST /api/events | 当前访客，同源，明确开启采集 | 保留原白名单、批次上限、用户归属、去重、限频；未同意 403 |
| POST /api/admin/session | 当前访客 + 独立访问码 | accessCode；发放 1 小时 HttpOnly 管理 Cookie |
| GET /api/admin/analytics?days=7 | 当前访客 + 与其绑定的管理 Cookie | 全站汇总，无正文与身份列表 |
| DELETE /api/admin/session | 当前访客，同源 | 撤销管理会话 |

days 必须为 1–90 的整数。统一错误结构 `{error:{code,message,retryable}}`，响应禁缓存。模型 Key 不是管理凭证。服务器没有配置 EXPRESSION_ADMIN_TOKEN（至少 32 字符）时，管理登录返回 503；普通用户访问汇总返回 403。5 次错误尝试后冷却，最多 50 个管理会话；服务重启全部失效。这是本机 P0 门禁，不是成熟企业身份系统。

## 数据口径

1. 训练漏斗以服务端 runs、attempts 为准，不相信客户端上报的完成或分数。时间窗按训练创建时刻计算，包含这些训练后续留存的作答。
2. started 是训练数；firstScored/secondScored 按各轮有结果的训练去重；completed 是两个集合交集。引导重说不产生独立完成，示例轮次会计入流程完成，但不计能力基准。
3. completionRate = completed / started，空分母返回 null。完成只表示流程走完，不表示有效、通过或能力提升；invalid、provisional、demo 另行提供。
4. baselineAverage 仅统计 independent 且有效、非暂定的服务端 baselineScoring；固定基准权重，不使用用户调高后的定制总分；按作答计均值，不是成长曲线。没有证据返回 null。
5. P50/P95 是成功留存结果的分析延迟；失败计数目前来自 assessment_failed 服务端模型错误事件，尚非所有 HTTP 错误的完整 SLI，也不含所有语音排队时延。
6. reportedTokens 仅统计成功留存结果中模型明确返回的 Token；未知为 null，明确 0 保留 0。不是账单，未覆盖失败调用、缓存收费、语音计算和存储成本。
7. activeLearners 是窗口内创建训练的不同访客数，不是登录人数，也不是页面 UV。同一个人清 Cookie 或换浏览器会视为不同访客。
8. events 使用接收时间窗口，可与训练 cohort 不同；客户端事件自愿采集，只辅助诊断流失，不作为评分事实。

## 最小埋点目录

- 服务端事实：training_started、assessment_finished、assessment_failed、knowledge_generation_finished、model_connection_tested。
- 可选客户端诊断：step_viewed、reading_completed、microphone_permission_resolved、asr_finished、asr_interrupted、transcript_confirmed、coach_hint_shown、training_resumed。
- 保留版本、训练/作答关联、受控错误码；不接收任意事件属性、原文、转录、录音、URL 或 Key。
- 浏览器同意前不缓存事件，最多缓存 100 条于内存；关闭后服务器拒收，浏览器收到 403 清队列。开关不删除历史，界面明确告知。
- 训练材料和回答作为业务记录保存，与可选埋点分开说明；本阶段尚未提供用户自助删除、导出和保留期清理，公开发布前需补齐。

## 代码与数据库

- `services/analytics_service.py`：只读统计，不产生评分。
- `services/operator_access.py`：独立授权、摘要存储、绑定、失效与限频。
- `services/training_store.py`：新增 preferences 表、runs(created,owner) 索引；CREATE IF NOT EXISTS，不删除旧数据。
- `frontend-src/analytics-settings.ts`：strict TypeScript，响应运行时校验；loading/empty/success/error 明确区分，过期响应不覆盖新筛选。
- `services/test_analytics.py`：8 个增量测试，复用 HTTP harness 但不重复计数旧用例。

数据库默认 `.p0-data/training.sqlite3`，可由 EXPRESSION_DATA_DIR 改变。SQLite 适用于当前单机 P0；统计会读取窗口内记录，尚无大数据量性能验收。生产前应补分页/预聚合、索引分析、备份恢复演练与容量限制。

## 本机使用

普通用户启动 `npm run web:p0:core`，打开设置 → 数据与隐私即可，无需管理员码或模型 Key 才能看已有汇总。

产品负责人如需全站汇总：在启动服务的终端安全设置 EXPRESSION_ADMIN_TOKEN 为独立随机访问码并导出，然后启动服务。应用不会自动加载 `.env.example`。不要复用模型 Key，不要把真实访问码写入 Git、截图或命令参数。查询命令：

```sh
python3 services/operator_report.py --days 7 --port 4173
```

命令通过不回显的密码提示输入访问码；只访问本机回环服务，打印无内容汇总，结束后撤销管理会话。访问码未配置时不会自动创建或绕过授权。HTTPS 反向代理发布时还需配置 EXPRESSION_SECURE_COOKIE=true，当前尚未部署。

## 验收与边界

40 个后端测试通过，其中本阶段覆盖空数据、个人隔离、两轮去重、示例/引导/无效/暂定剔除、时间窗、零用量与未知用量、管理员未配置/绑定/注销/到期/限频、跨站拒绝、可选采集授权与持久化。

真实模型收费调用、真人录音、OpenKB 抓取、云端考试与等级、跨设备账号、生产防滥用、删除/保留策略、运营告警尚未验收，不得把本阶段解释为完整上线后端完成。
