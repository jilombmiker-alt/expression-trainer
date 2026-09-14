"use strict";
(function installAnalytics(root) {
    const object = (value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            throw new Error('统计数据格式不正确，请重试。');
        return value;
    };
    const count = (value) => {
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
            throw new Error('统计数量不正确。');
        return value;
    };
    const percentage = (value) => {
        if (value === null)
            return null;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100)
            throw new Error('统计分值不正确。');
        return value;
    };
    function validate(value, scope = 'personal') {
        const data = object(value);
        const training = object(data.training);
        const assessment = object(data.assessment);
        if (data.schemaVersion !== 1 || data.scope !== scope)
            throw new Error('统计版本或访问范围不正确。');
        const days = count(data.days);
        if (days < 1 || days > 90)
            throw new Error('统计范围不正确。');
        const result = { schemaVersion: 1, scope, days,
            training: { started: count(training.started), completed: count(training.completed), completionRate: percentage(training.completionRate) },
            assessment: { saved: count(assessment.saved), invalid: count(assessment.invalid), baselineAverage: percentage(assessment.baselineAverage), baselineSamples: count(assessment.baselineSamples) } };
        if (result.training.completed > result.training.started || result.assessment.invalid > result.assessment.saved)
            throw new Error('统计口径不一致。');
        return result;
    }
    root.ExpressionAnalytics = { validate };
    if (!root.document?.getElementById('data-settings'))
        return;
    const doc = root.document;
    const element = (id) => doc.getElementById(id);
    const api = root.ExpressionFrontend;
    const panel = element('data-settings');
    const form = element('connection-form');
    const status = element('data-status');
    const metrics = element('data-metrics');
    const consent = element('analytics-consent');
    const privacyStatus = element('privacy-status');
    const refresh = element('refresh-data');
    const days = element('data-days');
    const scopeSelect = element('data-scope');
    const loginForm = element('operator-login');
    const logout = element('operator-logout');
    const code = element('operator-code');
    const details = element('operator-details');
    const eventList = element('operator-events');
    const privacy = doc.querySelector('.privacy-control');
    let revision = 0;
    async function load() {
        const current = ++revision;
        const scope = scopeSelect.value === 'operator' ? 'operator' : 'personal';
        element('data-title').textContent = scope === 'operator' ? '运营后台' : '我的训练数据';
        element('data-boundary').textContent = scope === 'operator'
            ? '仅全站汇总，不含用户正文或身份名单。完成率不代表达标率，Token 只统计成功留存调用，不能当作账单。'
            : '仅显示当前浏览器身份的服务端记录。清除身份 Cookie 或换设备后不能恢复关联；这不是正式账号，也不代表成长等级。';
        privacy.hidden = scope === 'operator';
        loginForm.hidden = true;
        logout.hidden = true;
        details.hidden = true;
        eventList.replaceChildren();
        metrics.hidden = true;
        status.textContent = '正在读取服务端记录…';
        refresh.disabled = true;
        try {
            const raw = await api.requestJson(`${scope === 'operator' ? '/api/admin/analytics' : '/api/analytics/summary'}?days=${days.value}`);
            const result = validate(raw, scope);
            if (current !== revision)
                return;
            status.textContent = result.training.started ? '已同步服务端记录；完成表示两轮均已评分，不表示考试达标。' : '还没有训练记录。开始并完成训练后，这里会显示真实结果。';
            metrics.replaceChildren();
            const items = [['开始的训练', result.training.started], ['完成两轮', result.training.completed], ['完成率', result.training.completionRate === null ? '暂无数据' : `${result.training.completionRate}%`], ['有效独立作答基准均值', result.assessment.baselineAverage === null ? '证据不足' : `${result.assessment.baselineAverage} 分`], ['已保存的作答', result.assessment.saved], ['无效作答', result.assessment.invalid]];
            items.forEach(([title, value]) => { const item = doc.createElement('div'); const term = doc.createElement('dt'); const definition = doc.createElement('dd'); term.textContent = title; definition.textContent = String(value); item.append(term, definition); metrics.append(item); });
            metrics.hidden = result.training.started === 0;
            if (scope === 'operator') {
                const data = object(raw);
                const service = object(data.service);
                const events = object(data.events);
                const errors = object(service.errors);
                const entries = [['活跃访客（非实名人数）', count(data.activeLearners)], ['分析失败请求', count(service.failedRequests)]];
                for (const [key, title] of [['p50Ms', '分析 P50（毫秒）'], ['p95Ms', '分析 P95（毫秒）'], ['reportedTokens', '已知 Token 用量']])
                    entries.push([title, service[key] === null ? '未知' : count(service[key])]);
                entries.forEach(([title, value]) => { const div = doc.createElement('div'); div.textContent = `${title}：${value}`; eventList.append(div); });
                for (const [prefix, source] of [['事件', events], ['错误', errors]])
                    Object.entries(source).forEach(([name, value]) => { const line = doc.createElement('div'); line.textContent = `${prefix} ${name}：${count(value)}`; eventList.append(line); });
                details.hidden = false;
                logout.hidden = false;
            }
        }
        catch (error) {
            if (current === revision) {
                metrics.hidden = true;
                details.hidden = true;
                const failure = api.normalizeError(error);
                if (scope === 'operator' && failure.status === 403) {
                    loginForm.hidden = false;
                    status.textContent = '请先验证管理员身份。';
                }
                else
                    status.textContent = `读取失败：${failure.userMessage} 请点击刷新重试。`;
            }
        }
        finally {
            if (current === revision)
                refresh.disabled = false;
        }
    }
    async function loadPrivacy() {
        try {
            const data = object(await api.requestJson('/api/privacy'));
            if (typeof data.optionalAnalytics !== 'boolean')
                throw new Error('隐私设置格式不正确。');
            consent.checked = data.optionalAnalytics;
            consent.disabled = false;
            privacyStatus.textContent = '';
        }
        catch (error) {
            consent.disabled = true;
            privacyStatus.textContent = `无法读取隐私设置：${api.normalizeError(error).userMessage}`;
        }
    }
    function show(data) {
        panel.hidden = !data;
        form.hidden = data;
        const modelTab = element('model-settings-tab');
        const dataTab = element('data-settings-tab');
        modelTab.classList.toggle('active', !data);
        dataTab.classList.toggle('active', data);
        modelTab.setAttribute('aria-pressed', String(!data));
        dataTab.setAttribute('aria-pressed', String(data));
        doc.querySelector('.screen-intro').hidden = data;
        doc.querySelector('.settings-stage').classList.toggle('data-mode', data);
        if (data) {
            void load();
            void loadPrivacy();
            panel.querySelector('h2')?.focus();
        }
    }
    element('model-settings-tab').addEventListener('click', () => show(false));
    element('data-settings-tab').addEventListener('click', () => show(true));
    refresh.addEventListener('click', () => { void load(); void loadPrivacy(); });
    days.addEventListener('change', () => { void load(); });
    scopeSelect.addEventListener('change', () => { code.value = ''; void load(); });
    loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submit = element('operator-submit');
        submit.disabled = true;
        status.textContent = '正在验证管理员身份…';
        try {
            await api.requestJson('/api/admin/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessCode: code.value }) });
            code.value = '';
            await load();
        }
        catch (error) {
            code.value = '';
            status.textContent = `无法进入后台：${api.normalizeError(error).userMessage}`;
        }
        finally {
            submit.disabled = false;
        }
    });
    logout.addEventListener('click', async () => {
        logout.disabled = true;
        try {
            await api.requestJson('/api/admin/session', { method: 'DELETE' });
            await load();
        }
        catch (error) {
            status.textContent = `退出失败：${api.normalizeError(error).userMessage}，请重试。`;
        }
        finally {
            logout.disabled = false;
        }
    });
    consent.addEventListener('change', async () => {
        const desired = consent.checked;
        consent.disabled = true;
        privacyStatus.textContent = '正在保存…';
        try {
            const data = object(await api.requestJson('/api/privacy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ optionalAnalytics: desired }) }));
            if (data.optionalAnalytics !== desired)
                throw new Error('隐私设置未确认。');
            privacyStatus.textContent = desired ? '已开启，返回训练后生效。' : '已关闭，后续可选事件将被服务器拒绝。';
        }
        catch (error) {
            consent.checked = !desired;
            privacyStatus.textContent = `保存失败：${api.normalizeError(error).userMessage}`;
        }
        finally {
            consent.disabled = false;
        }
    });
    const section = new URLSearchParams(root.location.search).get('section');
    if (section === 'operator')
        scopeSelect.value = 'operator';
    if (section === 'data' || section === 'operator')
        show(true);
})(window);
