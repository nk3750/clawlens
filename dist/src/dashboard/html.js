/** Returns the full HTML dashboard page as a string with embedded CSS and JS. */
export function getDashboardHtml() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ClawLens Dashboard</title>
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}

:root{
  --bg-page:#0e1015;
  --bg-card:#13151b;
  --bg-elevated:#191c24;
  --text-body:#d4d4d8;
  --text-heading:#f4f4f5;
  --text-muted:#838387;
  --border:#1e2028;
  --hover:#1f2330;
  --accent:#ff5c5c;
  --green:#22c55e;
  --red:#ef4444;
  --amber:#f59e0b;
  --blue:#3b82f6;
  --gray:#838387;
  --radius-sm:6px;
  --radius-md:10px;
  --radius-lg:14px;
  --font-sans:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  --font-mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;
}

body{
  background:var(--bg-page);
  color:var(--text-body);
  font-family:var(--font-sans);
  font-size:14px;
  line-height:1.55;
  -webkit-font-smoothing:antialiased;
  -moz-osx-font-smoothing:grayscale;
}

.container{
  max-width:720px;
  margin:0 auto;
  padding:16px;
  min-height:100vh;
  display:flex;
  flex-direction:column;
}

/* ── Header ────────────────────────────────────── */
header{
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:12px 0 20px;
}

header h1{
  font-size:18px;
  font-weight:600;
  color:var(--text-heading);
}

.brand{color:var(--accent);font-weight:700}

.refresh-btn{
  background:var(--bg-elevated);
  border:1px solid var(--border);
  color:var(--text-muted);
  padding:8px 14px;
  border-radius:var(--radius-sm);
  cursor:pointer;
  font-size:13px;
  font-family:var(--font-sans);
  display:flex;align-items:center;gap:6px;
  transition:border-color .15s,color .15s;
  min-height:44px;
}
.refresh-btn:hover{border-color:var(--accent);color:var(--text-body)}
.refresh-btn.loading .refresh-icon{animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}

/* ── Stat Cards ────────────────────────────────── */
.stat-grid{
  display:grid;
  grid-template-columns:repeat(4,1fr);
  gap:10px;
  margin-bottom:12px;
}

.stat-card{
  background:var(--bg-card);
  border:1px solid var(--border);
  border-radius:var(--radius-md);
  padding:16px 12px;
  text-align:center;
  transition:border-color .15s;
}
.stat-card:hover{border-color:color-mix(in srgb,var(--card-color) 40%,var(--border))}

.stat-value{
  font-size:28px;
  font-weight:700;
  color:var(--card-color,var(--text-heading));
  line-height:1.1;
  font-variant-numeric:tabular-nums;
}
.stat-label{
  font-size:11px;
  text-transform:uppercase;
  letter-spacing:.5px;
  color:var(--text-muted);
  margin-top:4px;
}

.stat-card.allowed{--card-color:var(--green)}
.stat-card.approved{--card-color:var(--amber)}
.stat-card.blocked{--card-color:var(--red)}
.stat-card.timedout{--card-color:var(--gray)}

/* ── Callout Badges ────────────────────────────── */
.callouts{
  display:flex;
  flex-wrap:wrap;
  gap:8px;
  margin-bottom:24px;
  min-height:32px;
}

.callout{
  display:inline-flex;
  align-items:center;
  gap:6px;
  padding:6px 12px;
  border-radius:20px;
  font-size:13px;
  font-weight:500;
  cursor:pointer;
  transition:opacity .15s;
  border:none;
  font-family:var(--font-sans);
}
.callout:hover{opacity:.85}
.callout.warn{background:color-mix(in srgb,var(--amber) 15%,transparent);color:var(--amber)}
.callout.danger{background:color-mix(in srgb,var(--red) 15%,transparent);color:var(--red)}
.callout.ok{background:color-mix(in srgb,var(--green) 12%,transparent);color:var(--green)}

/* ── Section Headers ───────────────────────────── */
.section-title{
  font-size:15px;
  font-weight:600;
  color:var(--text-heading);
  margin-bottom:12px;
}

/* ── Activity Feed ─────────────────────────────── */
.activity-section{flex:1}

.entry{
  background:var(--bg-card);
  border:1px solid var(--border);
  border-radius:var(--radius-md);
  margin-bottom:6px;
  overflow:hidden;
  transition:border-color .15s;
}
.entry:hover{border-color:var(--hover)}

.entry-header{
  display:grid;
  grid-template-columns:auto 1fr auto auto;
  align-items:center;
  gap:10px;
  padding:12px 14px;
  cursor:pointer;
  min-height:44px;
}

.entry-time{
  font-size:12px;
  color:var(--text-muted);
  white-space:nowrap;
  min-width:60px;
}

.entry-tool{
  font-family:var(--font-mono);
  font-size:13px;
  color:var(--text-heading);
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}

.badge{
  display:inline-flex;
  align-items:center;
  padding:2px 8px;
  border-radius:4px;
  font-size:11px;
  font-weight:600;
  text-transform:uppercase;
  letter-spacing:.3px;
  white-space:nowrap;
}
.badge.allow{background:color-mix(in srgb,var(--green) 15%,transparent);color:var(--green)}
.badge.block{background:color-mix(in srgb,var(--red) 15%,transparent);color:var(--red)}
.badge.approved{background:color-mix(in srgb,var(--amber) 15%,transparent);color:var(--amber)}
.badge.denied,.badge.timeout{background:color-mix(in srgb,var(--gray) 15%,transparent);color:var(--gray)}
.badge.pending{background:color-mix(in srgb,var(--amber) 15%,transparent);color:var(--amber)}
.badge.success{background:color-mix(in srgb,var(--green) 15%,transparent);color:var(--green)}
.badge.failure{background:color-mix(in srgb,var(--red) 15%,transparent);color:var(--red)}

.entry-rule{
  font-size:12px;
  color:var(--text-muted);
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
  max-width:160px;
  text-align:right;
}

.entry-detail{
  display:none;
  padding:0 14px 14px;
  border-top:1px solid var(--border);
}
.entry.expanded .entry-detail{display:block}
.entry.expanded{border-color:color-mix(in srgb,var(--accent) 30%,var(--border))}

.detail-grid{
  display:grid;
  grid-template-columns:auto 1fr;
  gap:4px 12px;
  font-size:13px;
  padding-top:12px;
}
.detail-key{
  color:var(--text-muted);
  font-size:12px;
}
.detail-val{
  color:var(--text-body);
  font-family:var(--font-mono);
  font-size:12px;
  word-break:break-all;
}

/* ── Load More ─────────────────────────────────── */
.load-more{
  display:none;
  width:100%;
  padding:12px;
  margin:8px 0 24px;
  background:var(--bg-card);
  border:1px solid var(--border);
  border-radius:var(--radius-sm);
  color:var(--text-muted);
  font-size:13px;
  font-family:var(--font-sans);
  cursor:pointer;
  text-align:center;
  min-height:44px;
  transition:border-color .15s,color .15s;
}
.load-more:hover{border-color:var(--accent);color:var(--text-body)}
.load-more.visible{display:block}

/* ── Empty State ───────────────────────────────── */
.empty-state{
  text-align:center;
  padding:48px 16px;
  color:var(--text-muted);
}
.empty-state .empty-icon{font-size:32px;margin-bottom:12px;display:block}
.empty-state p{font-size:14px}

/* ── Footer ────────────────────────────────────── */
footer{
  margin-top:auto;
  padding:20px 0 12px;
  border-top:1px solid var(--border);
  font-size:13px;
  color:var(--text-muted);
  display:flex;
  align-items:center;
  gap:8px;
}
footer .chain-ok{color:var(--green)}
footer .chain-broken{color:var(--red)}

/* ── Responsive ────────────────────────────────── */
@media(max-width:640px){
  .stat-grid{grid-template-columns:repeat(2,1fr)}

  .entry-header{
    grid-template-columns:1fr auto;
    grid-template-rows:auto auto;
    gap:4px 8px;
  }
  .entry-time{grid-column:1;grid-row:1}
  .entry-tool{grid-column:2;grid-row:1;text-align:right}
  .badge{grid-column:1;grid-row:2}
  .entry-rule{grid-column:2;grid-row:2;max-width:none}
}
</style>
</head>
<body>
<div class="container">

  <header>
    <h1><span class="brand">ClawLens</span> Dashboard</h1>
    <button class="refresh-btn" id="refresh-btn" aria-label="Refresh">
      <svg class="refresh-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
      Refresh
    </button>
  </header>

  <!-- Summary -->
  <section class="summary" id="summary">
    <div class="stat-grid">
      <div class="stat-card allowed"><div class="stat-value" id="val-allowed">--</div><div class="stat-label">Allowed</div></div>
      <div class="stat-card approved"><div class="stat-value" id="val-approved">--</div><div class="stat-label">Approved</div></div>
      <div class="stat-card blocked"><div class="stat-value" id="val-blocked">--</div><div class="stat-label">Blocked</div></div>
      <div class="stat-card timedout"><div class="stat-value" id="val-timedout">--</div><div class="stat-label">Timed Out</div></div>
    </div>
    <div class="callouts" id="callouts"></div>
  </section>

  <!-- Activity Feed -->
  <section class="activity-section">
    <h2 class="section-title">Recent Activity</h2>
    <div id="activity-feed"></div>
    <button class="load-more" id="load-more-btn">Load more</button>
  </section>

  <!-- Footer -->
  <footer id="footer">Checking audit integrity&hellip;</footer>

</div>

<script>
(function(){
  const API = '/plugins/clawlens';
  const PAGE_SIZE = 50;
  let currentOffset = 0;
  let totalLoaded = 0;

  // ── Helpers ──────────────────────────────────

  function relTime(iso){
    const diff = Date.now() - new Date(iso).getTime();
    const s = Math.floor(diff/1000);
    if(s<60) return 'just now';
    const m = Math.floor(s/60);
    if(m<60) return m+'m ago';
    const h = Math.floor(m/60);
    if(h<24) return h+'h ago';
    const d = Math.floor(h/24);
    if(d<7) return d+'d ago';
    return new Date(iso).toLocaleDateString();
  }

  function escHtml(str){
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  }

  function truncate(str, max){
    if(!str) return '';
    return str.length > max ? str.slice(0,max) + '\\u2026' : str;
  }

  // ── Render Stats ─────────────────────────────

  function renderStats(data){
    document.getElementById('val-allowed').textContent = data.allowed;
    document.getElementById('val-approved').textContent = data.approved;
    document.getElementById('val-blocked').textContent = data.blocked;
    document.getElementById('val-timedout').textContent = data.timedOut;

    const cal = document.getElementById('callouts');
    cal.innerHTML = '';

    if(data.pending > 0){
      const b = document.createElement('button');
      b.className = 'callout warn';
      b.textContent = data.pending + ' pending approval' + (data.pending>1?'s':'');
      b.onclick = function(){ document.getElementById('activity-feed').scrollIntoView({behavior:'smooth'}) };
      cal.appendChild(b);
    }
    if(data.blocked > 0){
      const b = document.createElement('button');
      b.className = 'callout danger';
      b.textContent = data.blocked + ' blocked action' + (data.blocked>1?'s':'');
      b.onclick = function(){ document.getElementById('activity-feed').scrollIntoView({behavior:'smooth'}) };
      cal.appendChild(b);
    }
    if(data.pending === 0 && data.blocked === 0){
      const b = document.createElement('span');
      b.className = 'callout ok';
      b.textContent = 'All clear';
      cal.appendChild(b);
    }
  }

  // ── Render Entries ───────────────────────────

  function badgeClass(dec){
    var map = {allow:'allow',block:'block',approved:'approved',denied:'denied',timeout:'timeout',pending:'pending',success:'success',failure:'failure'};
    return map[dec] || '';
  }

  function badgeLabel(dec){
    var map = {allow:'Allow',block:'Block',approved:'Approved',denied:'Denied',timeout:'Timed out',pending:'Pending',success:'Success',failure:'Failed'};
    return map[dec] || dec;
  }

  function renderEntry(e){
    var params = '';
    try{ params = JSON.stringify(e.params, null, 2); }catch(_){}

    var detailRows = '';
    if(params && params !== '{}'){
      detailRows += '<span class="detail-key">Params</span><span class="detail-val">'+escHtml(params)+'</span>';
    }
    if(e.severity){
      detailRows += '<span class="detail-key">Severity</span><span class="detail-val">'+escHtml(e.severity)+'</span>';
    }
    if(e.executionResult){
      detailRows += '<span class="detail-key">Result</span><span class="detail-val">'+escHtml(e.executionResult)+'</span>';
    }
    if(e.durationMs !== undefined && e.durationMs !== null){
      detailRows += '<span class="detail-key">Duration</span><span class="detail-val">'+e.durationMs+'ms</span>';
    }
    if(e.toolCallId){
      detailRows += '<span class="detail-key">Call ID</span><span class="detail-val">'+escHtml(e.toolCallId)+'</span>';
    }

    var div = document.createElement('div');
    div.className = 'entry';
    div.innerHTML =
      '<div class="entry-header">' +
        '<span class="entry-time">'+escHtml(relTime(e.timestamp))+'</span>' +
        '<span class="entry-tool">'+escHtml(e.toolName)+'</span>' +
        '<span class="badge '+badgeClass(e.effectiveDecision)+'">'+badgeLabel(e.effectiveDecision)+'</span>' +
        '<span class="entry-rule" title="'+(e.policyRule?escHtml(e.policyRule):'')+'">'+escHtml(truncate(e.policyRule||'',30))+'</span>' +
      '</div>' +
      (detailRows ? '<div class="entry-detail"><div class="detail-grid">'+detailRows+'</div></div>' : '');

    div.querySelector('.entry-header').addEventListener('click', function(){
      div.classList.toggle('expanded');
    });

    return div;
  }

  function renderEntries(entries, append){
    var feed = document.getElementById('activity-feed');
    if(!append) feed.innerHTML = '';

    if(entries.length === 0 && !append){
      feed.innerHTML =
        '<div class="empty-state">' +
          '<span class="empty-icon">\\u{1F4AD}</span>' +
          '<p>No activity recorded yet</p>' +
        '</div>';
      document.getElementById('load-more-btn').classList.remove('visible');
      return;
    }

    entries.forEach(function(e){
      feed.appendChild(renderEntry(e));
    });

    totalLoaded += entries.length;
    var btn = document.getElementById('load-more-btn');
    if(entries.length >= PAGE_SIZE){
      btn.classList.add('visible');
    } else {
      btn.classList.remove('visible');
    }
  }

  // ── Render Health ────────────────────────────

  function renderHealth(data){
    var footer = document.getElementById('footer');
    if(data.totalEntries === 0){
      footer.innerHTML = '<span style="color:var(--text-muted)">No audit entries to verify</span>';
    } else if(data.valid){
      footer.innerHTML = '<span class="chain-ok">\\u2713</span> Audit chain intact ('+data.totalEntries+' entries)';
    } else {
      footer.innerHTML = '<span class="chain-broken">\\u2717</span> Audit chain broken at entry '+data.brokenAt+' ('+data.totalEntries+' entries)';
    }
  }

  // ── Fetch ────────────────────────────────────

  function fetchJson(path){
    return fetch(API + path).then(function(r){
      if(!r.ok) throw new Error('HTTP '+r.status);
      return r.json();
    });
  }

  function fetchAll(){
    var btn = document.getElementById('refresh-btn');
    btn.classList.add('loading');
    btn.disabled = true;
    currentOffset = 0;
    totalLoaded = 0;

    Promise.all([
      fetchJson('/api/stats'),
      fetchJson('/api/entries?limit='+PAGE_SIZE+'&offset=0'),
      fetchJson('/api/health')
    ]).then(function(results){
      renderStats(results[0]);
      renderEntries(results[1], false);
      renderHealth(results[2]);
    }).catch(function(err){
      console.error('Dashboard fetch error:', err);
      document.getElementById('activity-feed').innerHTML =
        '<div class="empty-state"><p>Failed to load dashboard data</p></div>';
    }).finally(function(){
      btn.classList.remove('loading');
      btn.disabled = false;
    });
  }

  function loadMore(){
    currentOffset = totalLoaded;
    var btn = document.getElementById('load-more-btn');
    btn.textContent = 'Loading\\u2026';
    btn.disabled = true;

    fetchJson('/api/entries?limit='+PAGE_SIZE+'&offset='+currentOffset)
      .then(function(entries){
        renderEntries(entries, true);
      })
      .catch(function(err){
        console.error('Load more error:', err);
      })
      .finally(function(){
        btn.textContent = 'Load more';
        btn.disabled = false;
      });
  }

  // ── Init ─────────────────────────────────────

  document.getElementById('refresh-btn').addEventListener('click', fetchAll);
  document.getElementById('load-more-btn').addEventListener('click', loadMore);
  fetchAll();
})();
</script>
</body>
</html>`;
}
//# sourceMappingURL=html.js.map