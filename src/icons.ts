const svg = (paths: string) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
export const icons = {
  search: svg('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>'),
  arrow: svg('<path d="M4 12h16m-6-6 6 6-6 6"/>'),
  chevron: svg('<path d="m8 10 4 4 4-4"/>'),
  close: svg('<path d="m6 6 12 12M18 6 6 18"/>'),
  refresh: svg('<path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1"/>'),
  locate: svg('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>'),
  check: svg('<path d="m5 12 4 4L19 6"/>'),
  download: svg('<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>'),
  help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4.3 1.7L12 12v1m0 4h.01"/>'),
};
