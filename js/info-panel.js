// Owns index.html's info panel: the header's info icon and the panel's own close
// button both open/close it, and its two tabs (About this site / Facility Details)
// follow the WAI-ARIA APG Tabs pattern (single selected tab, arrow-key navigation,
// automatic activation). Kept separate from js/header.js — which is shared by
// every page — since this panel only exists on index.html.
//
// showDetailsTab() is exported for app.js/popup-accessibility.js to call when a
// map click or search result selects a facility: it opens the panel (if closed)
// and switches to the Facility Details tab, so the newly-shown content is
// actually visible before anything tries to move focus into it.
export function setupInfoPanel({ toggleButtonId, panelId, closeButtonId, tabs, detailsTabId }) {
  const toggleBtn = document.getElementById(toggleButtonId);
  const panel = document.getElementById(panelId);
  const closeBtn = document.getElementById(closeButtonId);
  const tabEls = tabs
    .map(({ tabId, panelId: tabPanelId }) => ({
      id: tabId,
      tab: document.getElementById(tabId),
      panel: document.getElementById(tabPanelId)
    }))
    .filter(({ tab, panel: tabPanel }) => tab && tabPanel);
  const detailsTabIndex = tabEls.findIndex(({ id }) => id === detailsTabId);

  function setPanelOpen(open) {
    if (!panel || !toggleBtn) return;
    panel.hidden = !open;
    toggleBtn.setAttribute('aria-expanded', String(open));
  }

  function activateTab(index, { moveFocus = false } = {}) {
    tabEls.forEach(({ tab, panel: tabPanel }, i) => {
      const active = i === index;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      tabPanel.hidden = !active;
      if (active && moveFocus) tab.focus();
    });
  }

  tabEls.forEach(({ tab }, index) => {
    tab.addEventListener('click', () => activateTab(index));
  });

  // Left/Right cycles between tabs; Home/End jump to the first/last. Automatic
  // activation (moving focus also selects), per the APG Tabs pattern — the
  // simplest, most common tabs keyboard model, and appropriate here since there
  // are only two tabs and no expensive content to defer loading.
  const tablist = tabEls[0]?.tab.closest('[role="tablist"]');
  if (tablist) {
    tablist.addEventListener('keydown', (event) => {
      const currentIndex = tabEls.findIndex(({ tab }) => tab === document.activeElement);
      if (currentIndex === -1) return;
      let nextIndex = null;
      if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabEls.length;
      else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabEls.length) % tabEls.length;
      else if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = tabEls.length - 1;
      if (nextIndex === null) return;
      event.preventDefault();
      activateTab(nextIndex, { moveFocus: true });
    });
  }

  if (toggleBtn && panel) {
    toggleBtn.addEventListener('click', () => {
      setPanelOpen(panel.hidden);
    });
  }

  if (closeBtn && panel && toggleBtn) {
    closeBtn.addEventListener('click', () => {
      setPanelOpen(false);
      toggleBtn.focus();
    });
  }

  return {
    showDetailsTab() {
      if (detailsTabIndex === -1) return;
      setPanelOpen(true);
      activateTab(detailsTabIndex);
    }
  };
}
