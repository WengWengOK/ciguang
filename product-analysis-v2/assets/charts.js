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

  // ===== Chart 1: 功能模块分类占比 (Pie) =====
  var chart1 = echarts.init(document.getElementById('chart-modules'), null, { renderer: 'svg' });
  chart1.setOption({
    animation: false,
    tooltip: {
      trigger: 'item',
      appendToBody: true,
      formatter: '{b}: {c}个 ({d}%)'
    },
    legend: {
      orient: 'vertical',
      right: '5%',
      top: 'center',
      textStyle: { color: muted, fontSize: 13 },
      itemWidth: 14,
      itemHeight: 14,
      itemGap: 12
    },
    series: [{
      name: '功能模块',
      type: 'pie',
      radius: ['40%', '70%'],
      center: ['35%', '50%'],
      avoidLabelOverlap: false,
      itemStyle: {
        borderRadius: 6,
        borderColor: bg2,
        borderWidth: 2
      },
      label: {
        show: true,
        formatter: '{b}\n{c}个',
        color: ink,
        fontSize: 12,
        fontWeight: 600
      },
      labelLine: {
        show: true,
        lineStyle: { color: rule }
      },
      data: [
        { value: 7, name: '核心学习模块', itemStyle: { color: accent } },
        { value: 3, name: '辅助管理模块', itemStyle: { color: accent2 } },
        { value: 2, name: '数据分析模块', itemStyle: { color: accent3 } }
      ]
    }]
  });
  window.addEventListener('resize', function() { chart1.resize(); });

  // ===== Chart 2: 产品优势维度雷达图 =====
  var chart2 = echarts.init(document.getElementById('chart-radar'), null, { renderer: 'svg' });
  chart2.setOption({
    animation: false,
    tooltip: {
      appendToBody: true,
      trigger: 'item'
    },
    radar: {
      indicator: [
        { name: '功能完整性', max: 100 },
        { name: 'AI集成深度', max: 100 },
        { name: '个性化程度', max: 100 },
        { name: '数据闭环', max: 100 },
        { name: '用户体验', max: 100 },
        { name: '技术架构', max: 100 },
        { name: '安全合规', max: 100 },
        { name: '可扩展性', max: 100 }
      ],
      shape: 'polygon',
      splitNumber: 5,
      axisName: {
        color: ink,
        fontSize: 13,
        fontWeight: 600
      },
      splitLine: {
        lineStyle: { color: rule, width: 1 }
      },
      splitArea: {
        areaStyle: {
          color: ['rgba(108,142,239,0.02)', 'rgba(108,142,239,0.04)', 'rgba(108,142,239,0.06)', 'rgba(108,142,239,0.08)', 'rgba(108,142,239,0.10)']
        }
      },
      axisLine: {
        lineStyle: { color: rule }
      }
    },
    series: [{
      name: '产品优势',
      type: 'radar',
      data: [
        {
          value: [90, 75, 60, 70, 55, 45, 30, 50],
          name: '当前水平',
          areaStyle: { color: 'rgba(108,142,239,0.15)' },
          lineStyle: { color: accent, width: 2 },
          itemStyle: { color: accent },
          symbol: 'circle',
          symbolSize: 6
        },
        {
          value: [95, 90, 90, 90, 85, 80, 85, 85],
          name: '目标水平',
          areaStyle: { color: 'rgba(196,167,231,0.08)' },
          lineStyle: { color: accent2, width: 2, type: 'dashed' },
          itemStyle: { color: accent2 },
          symbol: 'circle',
          symbolSize: 6
        }
      ]
    }],
    legend: {
      bottom: 10,
      textStyle: { color: muted, fontSize: 13 },
      itemWidth: 16,
      itemHeight: 4,
      data: ['当前水平', '目标水平']
    }
  });
  window.addEventListener('resize', function() { chart2.resize(); });

  // ===== Chart 3: AI改进方向优先级矩阵 (Scatter) =====
  var chart3 = echarts.init(document.getElementById('chart-priority'), null, { renderer: 'svg' });
  chart3.setOption({
    animation: false,
    tooltip: {
      appendToBody: true,
      formatter: function(params) {
        return '<b>' + params.data[3] + '</b><br/>影响力: ' + params.data[0] + '<br/>紧迫性: ' + params.data[1];
      }
    },
    grid: {
      left: '8%',
      right: '15%',
      bottom: '12%',
      top: '8%'
    },
    xAxis: {
      name: '影响力 →',
      nameLocation: 'end',
      nameTextStyle: { color: muted, fontSize: 12, padding: [0, 0, 0, 10] },
      min: 3,
      max: 10.5,
      splitLine: { lineStyle: { color: rule, type: 'dashed' } },
      axisLine: { lineStyle: { color: rule } },
      axisLabel: { color: muted, fontSize: 11 }
    },
    yAxis: {
      name: '↑ 紧迫性',
      nameTextStyle: { color: muted, fontSize: 12 },
      min: 3,
      max: 10.5,
      splitLine: { lineStyle: { color: rule, type: 'dashed' } },
      axisLine: { lineStyle: { color: rule } },
      axisLabel: { color: muted, fontSize: 11 }
    },
    series: [
      {
        name: 'P0 紧急',
        type: 'scatter',
        symbolSize: function(data) { return data[2]; },
        data: [
          [9.5, 9.8, 28, 'API Key安全修复'],
          [9.0, 9.2, 26, '云端数据同步']
        ],
        itemStyle: { color: danger, opacity: 0.8, shadowBlur: 10, shadowColor: 'rgba(232,125,125,0.3)' },
        label: {
          show: true,
          formatter: function(params) { return params.data[3]; },
          position: 'right',
          color: ink,
          fontSize: 11,
          fontWeight: 600
        }
      },
      {
        name: 'P1 核心',
        type: 'scatter',
        symbolSize: function(data) { return data[2]; },
        data: [
          [9.2, 7.5, 26, '自适应学习引擎'],
          [8.0, 7.0, 22, '错题OCR+AI归因']
        ],
        itemStyle: { color: warn, opacity: 0.8, shadowBlur: 10, shadowColor: 'rgba(240,184,110,0.3)' },
        label: {
          show: true,
          formatter: function(params) { return params.data[3]; },
          position: 'right',
          color: ink,
          fontSize: 11,
          fontWeight: 600
        }
      },
      {
        name: 'P2 拓展',
        type: 'scatter',
        symbolSize: function(data) { return data[2]; },
        data: [
          [7.0, 5.5, 20, 'AI口语练习'],
          [6.5, 5.0, 18, 'AI学习导师']
        ],
        itemStyle: { color: accent, opacity: 0.8, shadowBlur: 10, shadowColor: 'rgba(108,142,239,0.3)' },
        label: {
          show: true,
          formatter: function(params) { return params.data[3]; },
          position: 'right',
          color: ink,
          fontSize: 11,
          fontWeight: 600
        }
      },
      {
        name: 'P3 演进',
        type: 'scatter',
        symbolSize: function(data) { return data[2]; },
        data: [
          [6.0, 3.5, 18, '前端架构重构'],
          [5.5, 3.0, 16, '知识图谱与学习计划']
        ],
        itemStyle: { color: accent3, opacity: 0.8, shadowBlur: 10, shadowColor: 'rgba(125,211,160,0.3)' },
        label: {
          show: true,
          formatter: function(params) { return params.data[3]; },
          position: 'right',
          color: ink,
          fontSize: 11,
          fontWeight: 600
        }
      }
    ],
    legend: {
      bottom: 0,
      textStyle: { color: muted, fontSize: 12 },
      itemWidth: 14,
      itemHeight: 8,
      data: ['P0 紧急', 'P1 核心', 'P2 拓展', 'P3 演进']
    },
    visualMap: { show: false }
  });
  window.addEventListener('resize', function() { chart3.resize(); });

})();
