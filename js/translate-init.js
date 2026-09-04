// Full list of every language Google Translate supports would be overwhelming to
// scroll through in a compact header control. This narrows it to the ~30 languages
// most relevant to Douglas County residents: the largest groups by U.S. Census/ACS
// speaker counts for the Omaha metro (Spanish, Vietnamese, Chinese, Arabic,
// Swahili, French, German, Russian, Portuguese, Hindi), languages tied to Omaha's
// well-documented refugee and immigrant communities (South Sudanese, Burmese,
// Bhutanese-Nepali, Thai, Kurdish/Yazidi, Ethiopian, Rwandan, Burundian, Congolese,
// Bosnian, Ukrainian) that are under-represented in Census language-family buckets
// but are core to the county's own interpretation services, and a few more sizable
// immigrant communities (Korean, Filipino, Cantonese, Punjabi). One locally
// significant language — Karen (and its close relative Karenni), spoken by the
// largest and fastest-growing Karen refugee population in the US, here in Omaha —
// isn't in this list because Google Translate doesn't support it at all; nothing
// here can add languages it doesn't offer, only narrow the ones it does.
const RELEVANT_LANGUAGE_CODES = new Set([
  'es', // Spanish
  'vi', // Vietnamese
  'zh-CN', // Chinese (Simplified)
  'yue', // Cantonese
  'ar', // Arabic
  'sw', // Swahili
  'fr', // French
  'de', // German
  'so', // Somali
  'nus', // Nuer
  'din', // Dinka
  'ku', // Kurdish (Kurmanji)
  'ne', // Nepali
  'my', // Burmese
  'cnh', // Hakha Chin
  'dz', // Dzongkha
  'th', // Thai
  'am', // Amharic
  'fa', // Persian/Farsi
  'rw', // Kinyarwanda
  'rn', // Rundi/Kirundi
  'ln', // Lingala
  'bs', // Bosnian
  'uk', // Ukrainian
  'ru', // Russian
  'ko', // Korean
  'tl', // Filipino (Tagalog)
  'hi', // Hindi
  'pa', // Punjabi
  'pt' // Portuguese
]);

// Google's translate_a/element.js loader calls this by name once it's ready (via the
// `cb=` query param on its own <script> tag below), so it has to be a plain global
// function — not an ES module export, which the loader has no way to reach.
function googleTranslateElementInit() {
  new google.translate.TranslateElement(
    {
      pageLanguage: 'en',
      // HORIZONTAL renders a real, native <select> right away (visible in the DOM
      // as select.goog-te-combo) instead of SIMPLE's custom popup-menu link, which
      // has no native form control to hook a keyboard/screen-reader-accessible
      // custom look onto. We hide the rest of the gadget in CSS and style just
      // that <select>.
      layout: google.translate.TranslateElement.InlineLayout.HORIZONTAL,
      autoDisplay: false
    },
    'google_translate_element'
  );

  // Google occasionally injects an unrelated utility <iframe> (name="votingFrame")
  // with no accessible name anywhere on the page, not just inside our widget — a
  // known gap in the third-party script we have no markup of our own to fix
  // directly. Patch it wherever it lands as soon as it exists.
  const frameObserver = new MutationObserver(() => {
    document.querySelectorAll('iframe:not([title])').forEach((frame) => {
      frame.title = 'Google Translate';
    });
  });
  frameObserver.observe(document.body, { childList: true, subtree: true });

  // The <select> (and its language options) are injected asynchronously — wait for
  // it to actually appear before narrowing its options and wiring up the badge
  // that mirrors the current selection (e.g. "EN" -> "ES").
  const container = document.getElementById('google_translate_element');
  const badge = document.getElementById('langSelectCode');
  if (!container || !badge) return;

  function filterOptions(select) {
    Array.from(select.options).forEach((option) => {
      // '' is the "Select Language" placeholder; Google also adds an "English"
      // option (value "en") once a translation is active, as the way back to the
      // original — both need to stay selectable regardless of the allow-list above.
      const keep = option.value === '' || option.value === 'en' || RELEVANT_LANGUAGE_CODES.has(option.value);
      option.hidden = !keep;
      option.disabled = !keep;
    });
  }

  // Google only adds an "English" option to the list once a translation is already
  // active — there's nothing to switch back from before then — so on first load
  // there's no visible way back to English at all. Adding it ourselves up front
  // means it's always there; Google reuses this same option (rather than adding a
  // second one) once translation actually starts, so there's no duplicate.
  function ensureEnglishOption(select) {
    if (select.querySelector('option[value="en"]')) return;
    const option = document.createElement('option');
    option.value = 'en';
    option.textContent = 'English (original)';
    select.insertBefore(option, select.options[1] || null);
  }

  const widgetObserver = new MutationObserver(() => {
    const select = container.querySelector('select.goog-te-combo');
    if (!select) return;
    widgetObserver.disconnect();

    ensureEnglishOption(select);
    filterOptions(select);
    select.addEventListener('change', () => {
      const code = select.value || 'en';
      badge.textContent = code.slice(0, 2).toUpperCase();
    });

    // Google rebuilds this <select>'s entire <option> list (not just its selected
    // value) asynchronously in reaction to a selection — e.g. to add the "English"
    // revert option once a translation is active — so a one-off re-filter tied to
    // the change event above runs too early and gets overwritten. Watching the
    // select's own childList catches that rebuild whenever it actually happens and
    // re-applies our filter, instead of guessing at its timing.
    const optionsObserver = new MutationObserver(() => {
      ensureEnglishOption(select);
      filterOptions(select);
    });
    optionsObserver.observe(select, { childList: true });
  });
  widgetObserver.observe(container, { childList: true, subtree: true });
}
