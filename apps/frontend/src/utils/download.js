/**
 * Datei-Downloads über die authentifizierte axios-Instanz (Bearer nötig, daher kein <a href>).
 * Liefert den Dateinamen aus Content-Disposition, sonst den übergebenen Fallback.
 * `apiErrorMessage` liest die deutsche Fehlermeldung aus `error.response.data.error`,
 * auch wenn die Antwort wegen `responseType: 'blob'` als Blob ankommt.
 */
import api from '../services/api';

const filenameFromDisposition = (cd) => {
  if (!cd) return null;
  const star = cd.match(/filename\*=UTF-8''([^;]+)/i);
  if (star) { try { return decodeURIComponent(star[1]); } catch { /* ignorieren */ } }
  const plain = cd.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1] : null;
};

export async function downloadFile(url, { params, filename } = {}) {
  const res = await api.get(url, { params, responseType: 'blob' });
  const type = res.headers?.['content-type'] || 'application/octet-stream';
  const blob = new Blob([res.data], { type });
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filenameFromDisposition(res.headers?.['content-disposition']) || filename || 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
  return res;
}

export async function apiErrorMessage(err, fallback = 'Unbekannter Fehler') {
  const data = err?.response?.data;
  if (!data) return err?.message || fallback;
  if (typeof data === 'string') return data;
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text());
      return parsed.error || parsed.message || fallback;
    } catch {
      return fallback;
    }
  }
  return data.error || data.message || fallback;
}
