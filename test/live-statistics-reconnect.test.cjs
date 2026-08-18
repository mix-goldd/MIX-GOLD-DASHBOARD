const fs = require('fs');
const path = require('path');

describe('live statistics reconnect behavior', () => {
  const source = fs.readFileSync(path.join(__dirname, '../pages/dashboard/statistics.js'), 'utf8');

  it('tracks both realtime channels and catches up after each channel subscribes again', () => {
    expect(source).toContain("const channelStatuses = { views: 'CONNECTING', visits: 'CONNECTING' }");
    expect(source).toContain("if (status === 'SUBSCRIBED') catchUp();");
    expect(source).toContain("statuses.some((status) => status === 'SUBSCRIBED') || lastSyncOk");
    expect(source).toContain('const syncTimer = setInterval(catchUp, 15000)');
    expect(source).toContain("'انقطع اتصال البث مؤقتًا — جاري إعادة الاتصال ومزامنة الأرقام تلقائيًا…'");
  });

  it('subscribes site visits with a status callback instead of leaving it unobserved', () => {
    expect(source).toContain(".subscribe((status) => handleChannelStatus('visits', status));");
    expect(source).toContain(".subscribe((status) => handleChannelStatus('views', status));");
  });
});
