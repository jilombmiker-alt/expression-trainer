"use strict";
(function installLayout(root) {
    // Keep all panels in the DOM: changing the viewport never discards a recording or input.
    const groups = {
        '.plans-layout': ['编辑计划', '我的计划与考试'],
        '.growth-layout': ['能力等级', '分项能力', '变化趋势'],
        '.final-layout': ['表达对照', '速记分析', '下一步'],
        '.exam-layout': ['阅读材料', '独立作答'],
        '.exam-result-layout': ['本次结果', '分项结果', '下一步'],
        '.ai-coach-panel': ['教练说明', '问题与证据', '重新表达'],
        '.analysis-layout': ['表达数据', '内容理解', '改进练习'],
    };
    root.ExpressionLayout = { enhance(stage) {
            stage.querySelectorAll('.panel-picker').forEach((node) => node.remove());
            Object.entries(groups).forEach(([selector, labels]) => {
                const layout = stage.querySelector(selector);
                if (!layout)
                    return;
                const panels = Array.from(layout.children).filter((node) => node instanceof HTMLElement);
                layout.classList.add('switchable-layout');
                const label = document.createElement('label');
                label.className = 'panel-picker';
                const text = document.createElement('span');
                text.textContent = '查看';
                const select = document.createElement('select');
                select.setAttribute('aria-label', '切换当前步骤的内容');
                panels.forEach((panel, index) => {
                    panel.classList.add('switchable-panel');
                    panel.dataset.panelIndex = String(index);
                    const option = document.createElement('option');
                    option.value = String(index);
                    option.textContent = labels[index] || `内容 ${index + 1}`;
                    select.append(option);
                });
                const activate = () => panels.forEach((panel, index) => panel.classList.toggle('selected-panel', index === Number(select.value)));
                // During examination the hidden source must not become the default panel.
                if (layout.querySelector('#exam-answer'))
                    select.value = '1';
                if (selector === '.ai-coach-panel')
                    select.value = '1';
                select.addEventListener('change', activate);
                activate();
                label.append(text, select);
                layout.before(label);
            });
        } };
})(window);
