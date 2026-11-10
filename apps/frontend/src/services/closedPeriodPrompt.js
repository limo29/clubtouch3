/**
 * Brücke zwischen dem axios-Interceptor (services/api.js) und dem globalen Bestätigungsdialog
 * (components/common/ClosedPeriodDialog.js) für Änderungen in abgeschlossenen Geschäftsjahren.
 * Der Dialog meldet sich beim Einhängen als Handler an; ohne Handler (z. B. öffentliche Seiten)
 * gilt jede Rückfrage als abgebrochen.
 */
let handler = null;

export const setClosedPeriodHandler = (fn) => {
  handler = fn;
  return () => { if (handler === fn) handler = null; };
};

/** info: Antwort des Servers ({ error, code, fiscalYear }) → Promise<boolean> (true = trotzdem ändern) */
export const askClosedPeriod = (info) => (handler ? handler(info) : Promise.resolve(false));
