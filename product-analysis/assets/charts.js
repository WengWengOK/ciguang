(function() {
  var style = getComputedStyle(document.documentElement);
  var accent = style.getPropertyValue('--accent').trim();
  var accent2 = style.getPropertyValue('--accent2').trim();
  var accent3 = style.getPropertyValue('--accent3').trim();
  var ink = style.getPropertyValue('--ink').trim();
  var muted = style.getPropertyValue('--muted').trim();
  var rule = style.getPropertyValue('--rule').trim();
  var bg2 = style.getPropertyValue('--bg2').trim();
  var warn = style.getPropertyValue('--warn').trim();
  var danger = style.getPropertyValue('--danger').trim();

  // ===== Chart 1: AI Capability Distribution =====
  var chart1 = echarts.init(document.getElementById('chart-ai-dist'), null, { renderer: 'svg' });
  chart1.setOption({
    animation: false,
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, appendToBody: true },
    legend: {
      data: ['前端直连 AI', 'Node 后端', 'Spring Agent', '本地降级'],
      top: 0,
      textStyle: { color: muted, fontSize: 11 },
      itemWidth: 12, itemHeight: 12
    },
    grid: { left: '3%', right: '4%', bottom: '3%', top: '18%', containLabel: true },
    xAxis: {
      type: 'category',
      data: ['翻译评判', '阅读出题', '作文评分', '错题分析', '试卷分析', 'OCR识别', '学习诊断', '文档生成'],
      axisLabel: { color: muted, fontSize: 11, rotate: 0 },
      axisLine: { lineStyle: { color: rule } }
    },
    yAxis: {
      type: 'value',
      name: 'AI 调用路径数',
      nameTextStyle: { color: muted, fontSize: 11 },
      axisLabel: { color: muted, fontSize: 11 },
      splitLine: { lineStyle: { color: rule, type: 'dashed' } },
      axisLine: { lineStyle: { color: rule } }
    },
    series: [
      { name: '前端直连 AI', type: 'bar', stack: 'total', itemStyle: { color: accent }, data: [1, 1, 1, 1, 1, 1, 1, 0], barWidth: '40%' },
      { name: 'Node 后端', type: 'bar', stack: 'total', itemStyle: { color: accent2 }, data: [1, 0, 0, 0, 1, 1, 0, 0] },
      { name: 'Spring Agent', type: 'bar', stack: 'total', itemStyle: { color: accent3 }, data: [0, 1, 1, 0, 0, 1, 0, 1] },
      { name: '本地降级', type: 'bar', stack: 'total', itemStyle: { color: warn }, data: [1, 1, 1, 1, 1, 1, 1, 0] }
    ]
  });
  window.addEventListener('resize', function() { chart1.resize(); });

  // ===== Chart 2: Product Strengths Radar =====
  var chart2 = echarts.init(document.getElementById('chart-radar'), null, { renderer: 'svg' });
  chart2.setOption({
    animation: false,
    tooltip: { appendToBody: true },
    radar: {
      indicator: [
        { name: '功能完整度', max: 10 },
        { name: 'AI 集成深度', max: 10 },
        { name: '离线可用性', max: 10 },
        { name: '多模态能力', max: 10 },
        { name: '数据闭环', max: 10 },
        { name: '用户体验', max: 10 }
      ],
      shape: 'polygon',
      splitNumber: 5,
      axisName: { color: ink, fontSize: 12, fontWeight: 600 },
      splitLine: { lineStyle: { color: rule } },
      splitArea: { areaStyle: { color: ['rgba(108,142,239,0.02)', 'rgba(108,142,239,0.05)'] } },
      axisLine: { lineStyle: { color: rule } }
    },
    series: [{
      type: 'radar',
      data: [{
        value: [9, 8, 9, 7, 8, 7],
        name: '当前水平',
        areaStyle: { color: 'rgba(108,142,239,0.15)' },
        lineStyle: { color: accent, width: 2 },
        itemStyle: { color: accent }
      }]
    }]
  });
  window.addEventListener('resize', function() { chart2.resize(); });

  // ===== Chart 3: Weakness Impact & Urgency =====
  var chart3 = echarts.init(document.getElementById('chart-weakness'), null, { renderer: 'svg' });
  chart3.setOption({
    animation: false,
    tooltip: {
      trigger: 'item',
      appendToBody: true,
      formatter: function(p) {
        return '<b>' + p.data[3] + '</b><br/>影响度: ' + p.data[0] + '/10<br/>紧迫度: ' + p.data[1] + '/10';
      }
    },
    grid: { left: '3%', right: '5%', bottom: '10%', top: '10%', containLabel: true },
    xAxis: {
      type: 'value',
      name: '影响度',
      nameTextStyle: { color: muted, fontSize: 11 },
      min: 3, max: 10,
      axisLabel: { color: muted, fontSize: 11 },
      splitLine: { lineStyle: { color: rule, type: 'dashed' } },
      axisLine: { lineStyle: { color: rule } }
    },
    yAxis: {
      type: 'value',
      name: '紧迫度',
      nameTextStyle: { color: muted, fontSize: 11 },
      min: 3, max: 10,
      axisLabel: { color: muted, fontSize: 11 },
      splitLine: { lineStyle: { color: rule, type: 'dashed' } },
      axisLine: { lineStyle: { color: rule } }
    },
    series: [{
      type: 'scatter',
      data: [
        { value: [9, 9], name: '单体代码膨胀', symbolSize: 30, itemStyle: { color: danger, opacity: 0.75, borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1 } },
        { value: [9, 8], name: 'AI 缺乏个性化', symbolSize: 28, itemStyle: { color: danger, opacity: 0.75, borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1 } },
        { value: [8, 8], name: '学习路径无自适应', symbolSize: 26, itemStyle: { color: warn, opacity: 0.75, borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1 } },
        { value: [7, 7], name: '留存机制薄弱', symbolSize: 22, itemStyle: { color: warn, opacity: 0.75, borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1 } },
        { value: [7, 5], name: 'AI 配置门槛高', symbolSize: 20, itemStyle: { color: accent2, opacity: 0.75, borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1 } },
        { value: [6, 6], name: '架构冗余', symbolSize: 18, itemStyle: { color: accent, opacity: 0.75, borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1 } },
        { value: [5, 4], name: '移动端体验', symbolSize: 16, itemStyle: { color: accent3, opacity: 0.75, borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1 } },
        { value: [6, 5], name: '知识体系碎片化', symbolSize: 18, itemStyle: { color: accent, opacity: 0.75, borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1 } }
      ],
      label: {
        show: true,
        formatter: function(p) { return p.data.name; },
        position: 'top',
        color: ink,
        fontSize: 11,
        fontWeight: 600,
        distance: 6
      }
    }]
  });
  window.addEventListener('resize', function() { chart3.resize(); });

  // ===== Chart 4: AI Direction Investment vs Return =====
  var chart4 = echarts.init(document.getElementById('chart-direction'), null, { renderer: 'svg' });
  chart4.setOption({
    animation: false,
    tooltip: {
      trigger: 'item',
      appendToBody: true,
      formatter: function(p) {
        return '<b>' + p.data[3] + '</b><br/>预期收益: ' + p.data[0] + '/10<br/>实施难度: ' + p.data[1] + '/10<br/>优先级: ' + p.data[4];
      }
    },
    grid: { left: '3%', right: '5%', bottom: '12%', top: '10%', containLabel: true },
    xAxis: {
      type: 'value',
      name: '实施难度 →',
      nameTextStyle: { color: muted, fontSize: 11 },
      min: 2, max: 10,
      axisLabel: { color: muted, fontSize: 11 },
      splitLine: { lineStyle: { color: rule, type: 'dashed' } },
      axisLine: { lineStyle: { color: rule } }
    },
    yAxis: {
      type: 'value',
      name: '预期收益 →',
      nameTextStyle: { color: muted, fontSize: 11 },
      min: 4, max: 10,
      axisLabel: { color: muted, fontSize: 11 },
      splitLine: { lineStyle: { color: rule, type: 'dashed' } },
      axisLine: { lineStyle: { color: rule } }
    },
    series: [{
      type: 'scatter',
      symbolSize: 25,
      data: [
        { value: [5, 10], name: '自适应学习引擎', label: { show: true, formatter: '自适应学习引擎', position: 'top', color: ink, fontSize: 11, fontWeight: 600, distance: 8 }, itemStyle: { color: accent, opacity: 0.8, borderColor: 'rgba(255,255,255,0.15)', borderWidth: 1 } },
        { value: [7, 9], name: '代码模块化重构', label: { show: true, formatter: '代码模块化重构', position: 'top', color: ink, fontSize: 11, fontWeight: 600, distance: 8 }, itemStyle: { color: accent, opacity: 0.8, borderColor: 'rgba(255,255,255,0.15)', borderWidth: 1 } },
        { value: [5, 9], name: 'AI 导师对话', label: { show: true, formatter: 'AI 导师对话', position: 'top', color: ink, fontSize: 11, fontWeight: 600, distance: 8 }, itemStyle: { color: accent2, opacity: 0.8, borderColor: 'rgba(255,255,255,0.15)', borderWidth: 1 } },
        { value: [5, 8], name: '统一 AI 网关', label: { show: true, formatter: '统一 AI 网关', position: 'top', color: ink, fontSize: 11, fontWeight: 600, distance: 8 }, itemStyle: { color: accent2, opacity: 0.8, borderColor: 'rgba(255,255,255,0.15)', borderWidth: 1 } },
        { value: [8, 9], name: '知识图谱', label: { show: true, formatter: '知识图谱', position: 'top', color: ink, fontSize: 11, fontWeight: 600, distance: 8 }, itemStyle: { color: accent3, opacity: 0.8, borderColor: 'rgba(255,255,255,0.15)', borderWidth: 1 } },
        { value: [3, 7], name: '留存机制', label: { show: true, formatter: '留存机制', position: 'top', color: ink, fontSize: 11, fontWeight: 600, distance: 8 }, itemStyle: { color: accent3, opacity: 0.8, borderColor: 'rgba(255,255,255,0.15)', borderWidth: 1 } },
        { value: [8, 7], name: '多模态扩展', label: { show: true, formatter: '多模态扩展', position: 'top', color: ink, fontSize: 11, fontWeight: 600, distance: 8 }, itemStyle: { color: warn, opacity: 0.8, borderColor: 'rgba(255,255,255,0.15)', borderWidth: 1 } },
        { value: [9, 8], name: '学习社区', label: { show: true, formatter: '学习社区', position: 'top', color: ink, fontSize: 11, fontWeight: 600, distance: 8 }, itemStyle: { color: warn, opacity: 0.8, borderColor: 'rgba(255,255,255,0.15)', borderWidth: 1 } }
      ]
    }]
  });
  window.addEventListener('resize', function() { chart4.resize(); });
})();
