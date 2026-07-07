/* Clientforce shared sidebar — vanilla web component.
   Renders synchronously on mount so it paints with the host page's first frame
   (no nested-DC async flicker). Single source of truth for app navigation. */
(function () {
  if (window.customElements && customElements.get('cf-sidebar')) return;

  var GRAD = 'linear-gradient(135deg,#36D7ED,#35E834 55%,#D0F56B)';

  var MAIN = [
    { key: 'dashboard', label: 'Dashboard', icon: '◈', href: 'Dashboard.dc.html' },
    { key: 'agents', label: 'Agents', icon: '◎', href: 'Agents List.dc.html' },
    { key: 'contacts', label: 'Contacts', icon: '☺', href: 'Contacts.dc.html' },
    { key: 'stats', label: 'Stats', icon: '▤', href: 'Analytics.dc.html' },
    { key: 'integrations', label: 'Integrations', icon: '⚯', href: 'Integrations.dc.html' },
    { key: 'automations', label: 'Automations', icon: '⟳', href: 'Automations.dc.html' },
  ];
  var TOOLS = [
    { key: 'leadfinder', label: 'Lead Finder V2', icon: '⌖', href: 'Lead Finder.dc.html', badge: 'Auto Prospecting' },
    { key: 'proposals', label: 'Proposals', icon: '❒', href: 'Proposals.dc.html', badge: 'Dynamic', badgeBg: '#36D7ED', badgeActiveFg: '#36D7ED' },
    { key: 'forms', label: 'Forms', icon: '⊞', href: 'Forms.dc.html' },
    { key: 'widget', label: 'Agent Widget', icon: '⊕', href: 'Agent Widget.dc.html' },
    { key: 'linkedin', label: 'LinkedIn Extension', icon: 'in', href: 'LinkedIn Extension.dc.html' },
  ];
  var TOOL_KEYS = ['proposals', 'forms', 'widget', 'linkedin', 'leadfinder'];

  function esc(s) { return String(s); }

  function mainItem(m, active) {
    var on = m.key === active;
    return '<a href="' + m.href + '" style="text-decoration:none;display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:12px;margin-bottom:4px;font-size:15px;font-weight:' + (on ? 700 : 500) + ';color:' + (on ? '#0A0F0C' : 'rgba(255,255,255,.82)') + ';background:' + (on ? GRAD : 'transparent') + ';">' +
      '<span style="font-size:16px;width:20px;text-align:center;">' + m.icon + '</span>' + m.label + '</a>';
  }
  function toolItem(t, active) {
    var on = t.key === active;
    var badge = t.badge ? '<span style="margin-left:auto;font-size:8.5px;font-weight:800;letter-spacing:.03em;padding:2px 7px;border-radius:100px;white-space:nowrap;background:' + (on ? '#0A0F0C' : (t.badgeBg || GRAD)) + ';color:' + (on ? (t.badgeActiveFg || '#D0F56B') : (t.badgeFg || '#0A0F0C')) + ';">' + t.badge + '</span>' : '';
    return '<a href="' + t.href + '" style="text-decoration:none;display:flex;align-items:center;gap:11px;padding:9px 12px;border-radius:10px;margin-bottom:2px;font-size:14px;font-weight:' + (on ? 700 : 500) + ';color:' + (on ? '#0A0F0C' : 'rgba(255,255,255,.85)') + ';background:' + (on ? GRAD : 'transparent') + ';" onmouseover="if(!this.dataset.on)this.style.background=\'rgba(255,255,255,.07)\'" onmouseout="if(!this.dataset.on)this.style.background=\'transparent\'"' + (on ? ' data-on="1"' : '') + '>' +
      '<span style="font-size:14px;width:18px;text-align:center;">' + t.icon + '</span><span style="flex:1;">' + t.label + '</span>' + badge + '</a>';
  }
  function ddLink(href, color, icon, label) {
    return '<a href="' + href + '" style="text-decoration:none;display:flex;align-items:center;gap:11px;padding:9px 12px;border-radius:10px;font-size:14px;font-weight:500;color:' + color + ';" onmouseover="this.style.background=\'rgba(255,255,255,.07)\'" onmouseout="this.style.background=\'transparent\'">' +
      '<span style="width:18px;text-align:center;">' + icon + '</span>' + label + '</a>';
  }

  var PANEL = 'background:#14201A;border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:8px;box-shadow:0 20px 48px rgba(0,0,0,.5);z-index:40;';
  var DDHEAD = 'font-size:11px;text-transform:uppercase;letter-spacing:.14em;color:rgba(255,255,255,.4);padding:6px 12px 8px;';

  function render(active) {
    var toolsActive = TOOL_KEYS.indexOf(active) !== -1;
    var settingsOn = active === 'settings';

    var wsRows = [
      { name: 'Mensah Agency', tag: 'W', bg: 'linear-gradient(135deg,#36D7ED,#35E834)', check: '✓' },
      { name: 'Client — BrightSmile', tag: 'B', bg: '#D0F56B', check: '' },
    ].map(function (w) {
      return '<div data-close="1" style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px;font-size:14px;font-weight:500;color:rgba(255,255,255,.9);cursor:pointer;" onmouseover="this.style.background=\'rgba(255,255,255,.07)\'" onmouseout="this.style.background=\'transparent\'">' +
        '<span style="width:22px;height:22px;border-radius:6px;background:' + w.bg + ';display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#0A0F0C;">' + w.tag + '</span>' +
        '<span style="flex:1;">' + w.name + '</span>' +
        '<span style="color:#7FE8A0;font-size:13px;">' + w.check + '</span></div>';
    }).join('');

    var helpRows = [
      { icon: '?', label: 'Help center' },
      { icon: '✦', label: 'What\u2019s new' },
      { icon: '✉', label: 'Contact support' },
    ].map(function (h) {
      return '<div data-close="1" style="display:flex;align-items:center;gap:11px;padding:9px 12px;border-radius:10px;font-size:14px;font-weight:500;color:rgba(255,255,255,.9);cursor:pointer;" onmouseover="this.style.background=\'rgba(255,255,255,.07)\'" onmouseout="this.style.background=\'transparent\'"><span style="width:18px;text-align:center;">' + h.icon + '</span>' + h.label + '</div>';
    }).join('');

    return '' +
    '<div style="width:100%;height:100%;min-height:100vh;background:#0C140F;color:#fff;padding:22px 16px;display:flex;flex-direction:column;position:relative;box-sizing:border-box;font-family:\'Hanken Grotesk\',sans-serif;">' +
      '<a href="Dashboard.dc.html" style="text-decoration:none;color:#fff;display:flex;align-items:center;gap:10px;padding:6px 8px;margin-bottom:22px;">' +
        '<div style="width:32px;height:32px;border-radius:9px;background:' + GRAD + ';display:flex;align-items:center;justify-content:center;font-family:\'Bricolage Grotesque\',sans-serif;font-weight:800;color:#0A0F0C;font-size:18px;">f</div>' +
        '<span style="font-family:\'Bricolage Grotesque\',sans-serif;font-weight:700;font-size:19px;">Clientforce</span>' +
      '</a>' +

      // workspace switcher
      '<div style="position:relative;margin-bottom:18px;">' +
        '<div data-toggle="ws" style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:12px;background:rgba(255,255,255,.06);cursor:pointer;">' +
          '<span style="width:26px;height:26px;border-radius:7px;background:rgba(255,255,255,.1);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;color:#7FE8A0;">W</span>' +
          '<span style="font-size:14px;font-weight:500;flex:1;">Workspace</span>' +
          '<span data-chev="ws" style="color:rgba(255,255,255,.45);font-size:12px;">\u2304</span>' +
        '</div>' +
        '<div data-dd="ws" style="display:none;position:absolute;left:0;right:0;top:calc(100% + 6px);' + PANEL + '">' +
          '<div style="' + DDHEAD + '">Switch workspace</div>' + wsRows +
          '<div style="margin-top:4px;border-top:1px solid rgba(255,255,255,.08);padding-top:4px;">' +
            ddLink('Account Admin.dc.html#workspaces', '#7FE8A0', '◫', 'View all workspaces \u203A') +
            ddLink('Account Admin.dc.html#billing', 'rgba(255,255,255,.85)', '\uFF04', 'Account &amp; billing \u203A') +
          '</div>' +
        '</div>' +
      '</div>' +

      // primary nav
      MAIN.map(function (m) { return mainItem(m, active); }).join('') +

      // tools
      '<div style="position:relative;margin-top:4px;">' +
        '<div data-toggle="tools" style="display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:12px;margin-bottom:3px;font-size:15px;font-weight:' + (toolsActive ? 700 : 500) + ';color:' + (toolsActive ? '#0A0F0C' : 'rgba(255,255,255,.82)') + ';cursor:pointer;background:' + (toolsActive ? GRAD : 'transparent') + ';">' +
          '<span style="font-size:16px;width:20px;text-align:center;">\u2692</span><span style="flex:1;">Tools</span>' +
          '<span data-chev="tools" style="font-size:12px;color:rgba(255,255,255,.55);">\u25B8</span>' +
        '</div>' +
        '<div data-dd="tools" style="display:none;position:absolute;left:calc(100% + 12px);top:-4px;width:264px;' + PANEL + '">' +
          '<div style="' + DDHEAD + '">Tools</div>' +
          TOOLS.map(function (t) { return toolItem(t, active); }).join('') +
        '</div>' +
      '</div>' +

      '<div style="' + DDHEAD + 'padding:14px 14px 6px;">Help &amp; account</div>' +
      '<div data-toggle="help" style="display:flex;align-items:center;gap:12px;padding:9px 14px;border-radius:12px;margin-bottom:3px;font-size:14px;font-weight:500;color:rgba(255,255,255,.82);cursor:pointer;" onmouseover="this.style.background=\'rgba(255,255,255,.05)\'" onmouseout="this.style.background=\'transparent\'">' +
        '<span style="font-size:14px;width:20px;text-align:center;">?</span>Help</div>' +
      '<a href="Settings.dc.html" style="text-decoration:none;display:flex;align-items:center;gap:12px;padding:9px 14px;border-radius:12px;margin-bottom:3px;font-size:14px;font-weight:' + (settingsOn ? 700 : 500) + ';color:' + (settingsOn ? '#0A0F0C' : 'rgba(255,255,255,.82)') + ';background:' + (settingsOn ? GRAD : 'transparent') + ';">' +
        '<span style="font-size:14px;width:20px;text-align:center;">\u2699</span>Settings</a>' +

      // profile
      '<div style="margin-top:auto;position:relative;">' +
        '<div data-toggle="profile" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;background:rgba(255,255,255,.05);cursor:pointer;margin-top:18px;">' +
          '<div style="width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#36D7ED,#35E834);color:#0A0F0C;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;">JM</div>' +
          '<div style="line-height:1.2;flex:1;"><div style="font-size:14px;font-weight:600;">Jordan Mensah</div><div style="font-size:12px;color:rgba(255,255,255,.5);">Agency owner</div></div>' +
          '<span data-chev="profile" style="color:rgba(255,255,255,.4);">\u2304</span>' +
        '</div>' +
        '<div data-dd="profile" style="display:none;position:absolute;left:0;right:0;bottom:calc(100% + 8px);' + PANEL + '">' +
          ddLink('Account Admin.dc.html', 'rgba(255,255,255,.9)', '☺', 'Account') +
          ddLink('Settings.dc.html', 'rgba(255,255,255,.9)', '\u2699', 'Settings') +
          ddLink('Onboarding.dc.html', '#F0A89A', '\u23FB', 'Sign out') +
        '</div>' +
      '</div>' +

      // help flyout
      '<div data-dd="help" style="display:none;position:absolute;left:calc(100% + 12px);bottom:64px;width:240px;' + PANEL + '">' +
        '<div style="' + DDHEAD + '">Help &amp; resources</div>' + helpRows +
      '</div>' +
    '</div>';
  }

  var Sidebar = function () {};
  Sidebar = (function () {
    function define() {
      customElements.define('cf-sidebar', class extends HTMLElement {
        connectedCallback() {
          if (this._mounted) return;
          this._mounted = true;
          if (!document.getElementById('cf-sidebar-fonts')) {
            var fl = document.createElement('link');
            fl.id = 'cf-sidebar-fonts';
            fl.rel = 'stylesheet';
            fl.href = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,700;12..96,800&family=Hanken+Grotesk:wght@400;500;600;700&display=swap';
            document.head.appendChild(fl);
          }
          this.style.display = 'block';
          this.style.background = '#0C140F';
          var active = this.getAttribute('active') || 'dashboard';
          var root = this.attachShadow ? this.attachShadow({ mode: 'open' }) : this;
          this._root = root;
          root.innerHTML = render(active);
          this._wire(root);
        }
        _wire(root) {
          var self = this;
          var dds = { ws: root.querySelector('[data-dd="ws"]'), tools: root.querySelector('[data-dd="tools"]'), help: root.querySelector('[data-dd="help"]'), profile: root.querySelector('[data-dd="profile"]') };
          var chevs = { ws: root.querySelector('[data-chev="ws"]'), tools: root.querySelector('[data-chev="tools"]'), profile: root.querySelector('[data-chev="profile"]') };
          var OPEN = { ws: '\u25B4', tools: '\u25BE', profile: '\u25B4' };
          var SHUT = { ws: '\u2304', tools: '\u25B8', profile: '\u2304' };
          function closeAll(except) {
            Object.keys(dds).forEach(function (k) {
              if (k === except) return;
              if (dds[k]) dds[k].style.display = 'none';
              if (chevs[k]) chevs[k].textContent = SHUT[k];
            });
          }
          root.querySelectorAll('[data-toggle]').forEach(function (t) {
            t.addEventListener('click', function (e) {
              e.stopPropagation();
              var k = t.getAttribute('data-toggle');
              var dd = dds[k]; if (!dd) return;
              var isOpen = dd.style.display !== 'none';
              closeAll(k);
              dd.style.display = isOpen ? 'none' : 'block';
              if (chevs[k]) chevs[k].textContent = isOpen ? SHUT[k] : OPEN[k];
            });
          });
          root.querySelectorAll('[data-close]').forEach(function (c) {
            c.addEventListener('click', function () { closeAll(); });
          });
          document.addEventListener('click', function (e) {
            var path = e.composedPath ? e.composedPath() : [];
            if (path.indexOf(self) === -1) closeAll();
          });
        }
      });
    }
    if (window.customElements) define();
    return true;
  })();
})();
