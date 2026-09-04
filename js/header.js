// Shared header behavior for every page: the mobile hamburger menu, the
// dropdown/disclosure buttons in it (Contact us, Accessibility statement — pages
// with their own extra dropdowns, like index.html's Map layers, call the returned
// setupDropdown for those), and the About dialog. Centralized here rather than
// duplicated per page so a future change to any of this only has to happen once.

const ABOUT_DIALOG_STORAGE_KEY = 'i2g-hide-about-dialog';

/**
 * @param {{ autoOpenAbout?: boolean, aboutPanelId?: string|null }} options -
 *   autoOpenAbout shows the About dialog on load (unless the user previously
 *   checked "don't show again") — only pages with an #aboutDialog use this.
 *   aboutPanelId points the header's info icon (#infoToggle) at a static,
 *   persistent About panel to show/hide instead of opening the About dialog —
 *   only index.html, which has a left-hand About panel next to the map, passes this.
 */
export function setupHeader({ autoOpenAbout = false, aboutPanelId = null } = {}) {
  const openDropdowns = new Map(); // panel -> button, for outside-click/Escape close

  function closeDropdown(panel) {
    const button = openDropdowns.get(panel);
    if (!button) return;
    button.setAttribute('aria-expanded', 'false');
    panel.hidden = true;
    openDropdowns.delete(panel);
  }

  // restoreFocus matters for keyboard users: hiding a panel that contains the
  // currently-focused button (the one that opened it) silently drops focus to
  // <body>, since a focused element inside a newly-hidden ancestor can't stay
  // focused. Pass true when the close is a deliberate user action (Escape,
  // selecting a list item) so focus lands back on the toggle button instead of
  // vanishing. Left false for incidental closes (e.g. clicking elsewhere on the
  // page), where yanking focus back to the button would be surprising.
  function closeAllDropdowns({ restoreFocus = false } = {}) {
    openDropdowns.forEach((button, panel) => {
      closeDropdown(panel);
      if (restoreFocus) button.focus();
    });
  }

  function setupDropdown(buttonId, panelId) {
    const button = document.getElementById(buttonId);
    const panel = document.getElementById(panelId);
    if (!button || !panel) return;

    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const expanded = button.getAttribute('aria-expanded') === 'true';

      // Only one dropdown open at a time.
      openDropdowns.forEach((_openButton, openPanel) => closeDropdown(openPanel));

      if (expanded) return;

      button.setAttribute('aria-expanded', 'true');
      panel.hidden = false;
      openDropdowns.set(panel, button);
    });

    panel.addEventListener('click', (event) => event.stopPropagation());
  }

  const menuToggleBtn = document.getElementById('menuToggle');
  const headerActionsMenu = document.getElementById('headerActionsMenu');

  // Below the 720px breakpoint, the header icons collapse into this hamburger-triggered
  // menu (see the .header-actions rules in that media query). Kept separate from
  // setupDropdown/openDropdowns above: that mechanism closes every other open dropdown
  // whenever one opens, which would immediately close this menu when its own nested
  // "Contact us" dropdown (setupDropdown('contactToggle', ...) below) is opened from inside it.
  function setHeaderMenuOpen(open) {
    headerActionsMenu.classList.toggle('is-open', open);
    menuToggleBtn.setAttribute('aria-expanded', String(open));
    const label = open ? 'Close menu' : 'Open menu';
    menuToggleBtn.setAttribute('aria-label', label);
    menuToggleBtn.setAttribute('title', label);
  }

  if (menuToggleBtn && headerActionsMenu) {
    menuToggleBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      setHeaderMenuOpen(!headerActionsMenu.classList.contains('is-open'));
    });

    headerActionsMenu.addEventListener('click', (event) => event.stopPropagation());
  }

  document.addEventListener('click', () => {
    closeAllDropdowns();
    if (menuToggleBtn && headerActionsMenu) setHeaderMenuOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    closeAllDropdowns({ restoreFocus: true });
    if (menuToggleBtn && headerActionsMenu?.classList.contains('is-open')) {
      setHeaderMenuOpen(false);
      menuToggleBtn.focus();
    }
  });

  const infoToggleBtn = document.getElementById('infoToggle');

  // Unlike the dropdowns above, this panel is static/persistent: it should only
  // close when the user re-clicks the info icon, not on outside clicks or Escape,
  // so it's wired up separately from setupDropdown/closeAllDropdowns.
  if (aboutPanelId && infoToggleBtn) {
    const aboutPanel = document.getElementById(aboutPanelId);

    if (aboutPanel) {
      const setAboutPanelOpen = (open) => {
        aboutPanel.hidden = !open;
        infoToggleBtn.setAttribute('aria-expanded', String(open));
      };

      infoToggleBtn.addEventListener('click', () => {
        setAboutPanelOpen(aboutPanel.hidden);
      });
    }
  }

  const aboutDialog = document.getElementById('aboutDialog');
  const hideAboutCheckbox = document.getElementById('hideAboutCheckbox');

  if (!aboutPanelId && aboutDialog && infoToggleBtn && hideAboutCheckbox) {
    const getHideAboutPreference = () => {
      try {
        return localStorage.getItem(ABOUT_DIALOG_STORAGE_KEY) === 'true';
      } catch {
        // localStorage can throw in private-browsing/storage-blocked contexts —
        // fall back to always showing the dialog on load in that case.
        return false;
      }
    };

    const openAboutDialog = () => {
      hideAboutCheckbox.checked = getHideAboutPreference();
      aboutDialog.showModal();
    };

    // Fires on every close, whether via the X button, the Continue button, or
    // Escape — each is the user's chance to set (or clear) their preference.
    aboutDialog.addEventListener('close', () => {
      try {
        localStorage.setItem(ABOUT_DIALOG_STORAGE_KEY, String(hideAboutCheckbox.checked));
      } catch {
        // Ignore storage failures — worst case the dialog just shows again next time.
      }
    });

    infoToggleBtn.addEventListener('click', () => {
      openAboutDialog();
    });

    if (autoOpenAbout && !getHideAboutPreference()) {
      openAboutDialog();
    }
  }

  setupDropdown('contactToggle', 'contactPanel');
  setupDropdown('accessibilityToggle', 'accessibilityPanel');

  return { setupDropdown, closeAllDropdowns };
}
