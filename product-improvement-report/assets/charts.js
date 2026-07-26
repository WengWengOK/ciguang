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

  // ===== Chart 1: 自适应学习引擎工作流 (Sankey) =====
  var chart1 = echarts.init(document.getElementById('chart-flow'), null, { renderer: 'svg' });
  chart1.setOption({
    animation: false,
    tooltip: { appendToBody: true, trigger: 'item' },
    series: [{
      type: 'sankey',
      layout: 'none',
      emphasis: { focus: 'adjacency' },
      nodeAlign: 'left',
      nodeGap: 12,
      lineStyle: { color: 'gradient', curveness: 0.5, opacity: 0.4 },
      label: { color: ink, fontSize: 12, fontWeight: 600 },
      itemStyle: { borderWidth: 0 },
      data: [
        { name: '用户答题', itemStyle: { color: accent } },
        { name: '数据采集', itemStyle: { color: accent } },
        { name: '正确率分析', itemStyle: { color: accent2 } },
        { name: '响应时间', itemStyle: { color: accent2 } },
        { name: '错题类型', itemStyle: { color: accent2 } },
        { name: '能力画像更新', itemStyle: { color: accent3 } },
        { name: '难度调整', itemStyle: { color: warn } },
        { name: '内容推荐', itemStyle: { color: warn } },
        { name: '复习调度', itemStyle: { color: warn } }
      ],
      links: [
        { source: '用户答题', target: '数据采集', value: 10 },
        { source: '数据采集', target: '正确率分析', value: 4 },
        { source: '数据采集', target: '响应时间', value: 3 },
        { source: '数据采集', target: '错题类型', value: 3 },
        { source: '正确率分析', target: '能力画像更新', value: 4 },
        { source: '响应时间', target: '能力画像更新', value: 3 },
        { source: '错题类型', target: '能力画像更新', value: 3 },
        { source: '能力画像更新', target: '难度调整', value: 4 },
        { source: '能力画像更新', target: '内容推荐', value: 3 },
        { source: '能力画像更新', target: '复习调度', value: 3 }
      ]
    }]
  });
  window.addEventListener('resize', function() { chart1.resize(); });

  // ===== Chart 2: 12周改进路线图甘特图 =====
  var chart2 = echarts.init(document.getElementById('chart-gantt'), null, { renderer: 'svg' });
  var phases = [
    'AI学习导师对话',
    'AI口语练习模块',
    '错题OCR+AI归因',
    '艾宾浩斯复习',
    '动态难度调整',
    '实时能力画像',
    '云端数据同步',
    'API Key安全迁移'
  ];
  var phaseData = [
    // API Key安全迁移: 第1-2周
    { name: 'API Key安全迁移', start: 0, end: 2, priority: 'P0' },
    // 云端数据同步: 第1-2周
    { name: '云端数据同步', start: 0, end: 2, priority: 'P0' },
    // 实时能力画像: 第3-5周
    { name: '实时能力画像', start: 2, end: 5, priority: 'P1' },
    // 动态难度调整: 第4-6周
    { name: '动态难度调整', start: 3, end: 6, priority: 'P1' },
    // 艾宾浩斯复习: 第5-8周
    { name: '艾宾浩斯复习', start: 4, end: 8, priority: 'P1' },
    // 错题OCR+AI归因: 第7-10周
    { name: '错题OCR+AI归因', start: 6, end: 10, priority: 'P2' },
    // AI口语练习模块: 第8-12周
    { name: 'AI口语练习模块', start: 7, end: 12, priority: 'P2' },
    // AI学习导师对话: 第9-12周
    { name: 'AI学习导师对话', start: 8, end: 12, priority: 'P2' }
  ];

  var colorMap = {
    'P0': danger,
    'P1': warn,
    'P2': accent,
    'P3': accent3
  };

  var seriesData = phaseData.map(function(item, idx) {
    return {
      name: item.name,
      value: [item.start, item.end],
      itemStyle: { color: colorMap[item.priority], opacity: 0.85 }
    };
  });

  chart2.setOption({
    animation: false,
    tooltip: {
      appendToBody: true,
      formatter: function(params) {
        var start = params.data.value[0];
        var end = params.data.value[1];
        return '<b>' + params.data.name + '</b><br/>第' + (start+1) + '-' + end + '周';
      }
    },
    grid: { left: '18%', right: '8%', bottom: '10%', top: '8%' },
    xAxis: {
      type: 'value',
      name: '周',
      nameLocation: 'end',
      nameTextStyle: { color: muted, fontSize: 12 },
      min: 0,
      max: 12,
      interval: 1,
      splitLine: { lineStyle: { color: rule, type: 'dashed' } },
      axisLine: { lineStyle: { color: rule } },
      axisLabel: { color: muted, fontSize: 11, formatter: function(v) { return 'W' + (v+1); } }
    },
    yAxis: {
      type: 'category',
      data: phases,
      axisLine: { lineStyle: { color: rule } },
      axisLabel: { color: ink, fontSize: 12, fontWeight: 600 },
      axisTick: { show: false }
    },
    series: [{
      type: 'custom',
      renderItem: function(params, api) {
        var categoryIndex = api.value(0);
        var start = api.coord([api.value(1), categoryIndex]);
        var end = api.coord([api.value(2), categoryIndex]);
        var height = api.size([0, 1])[1] * 0.5;
        var item = seriesData[categoryIndex];
        return {
          type: 'rect',
          shape: {
            x: start[0],
            y: start[1] - height / 2,
            width: end[0] - start[0],
            height: height,
            r: 4
          },
          style: api.style()
        };
      },
      encode: { x: [1, 2], y: 0 },
      data: phaseData.map(function(item, idx) {
        return {
          name: item.name,
          value: [idx, item.start, item.end],
          itemStyle: { color: colorMap[item.priority], opacity: 0.85 }
        };
      })
    }],
    legend: {
      bottom: 0,
      textStyle: { color: muted, fontSize: 12 },
      itemWidth: 14,
      itemHeight: 8,
      data: [
        { name: 'P0 紧急', itemStyle: { color: danger } },
        { name: 'P1 核心', itemStyle: { color: warn } },
        { name: 'P2 拓展', itemStyle: { color: accent } }
      ]
    }
  });
  window.addEventListener('resize', function() { chart2.resize(); });

})();
