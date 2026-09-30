/** Laufband-Einträge aus Meldungen, Zielständen, Team-Abständen und Fakten. */
import { money, num, fmtNumber } from '../../utils/format';
import { dateDE, goalValueText, timeHM } from './format';

const MAX_EVENTS = 6;

export function buildTickerItems(data, tickerEvents, { lastArchive } = {}) {
  const items = [];

  (tickerEvents || []).slice(0, MAX_EVENTS).forEach((e) => {
    items.push({ id: `ev-${e.id}`, text: e.text || e.title, group: e.group || null, kind: 'event' });
  });

  const goals = data?.goals;
  (goals?.goals || []).forEach((g) => {
    const target = num(g.displayTarget) || num(g.target);
    const current = num(g.current);
    const name = `${g.group ? `${g.group.name}: ` : ''}${g.label || g.articleName || g.category || 'Tagesumsatz'}`;
    if (!target) return;
    if (!goals.movingTargets && current >= target) {
      items.push({ id: `goal-${g.id}`, text: `${name} – Ziel geschafft${g.reachedBy?.name ? ` (letzter Kauf: ${g.reachedBy.name})` : ''}!`, group: g.group || null });
      return;
    }
    const rest = Math.max(0, target - current);
    const upp = g.kind === 'ARTICLE' ? Math.max(1, num(g.unitsPerPurchase)) : 1;
    let text;
    if (upp > 1 && g.kind === 'ARTICLE') {
      const crate = Math.min(Math.ceil(target / upp), Math.floor(current / upp) + 1);
      const toCrate = crate * upp - current;
      text = `${name}: noch ${fmtNumber(toCrate)} bis ${g.purchaseUnit || 'Kiste'} ${crate} voll`;
    } else {
      text = `${name}: noch ${goalValueText(g, rest)} bis zum Ziel`;
    }
    if (g.forecastAt) text += ` – bei dem Tempo um ~${timeHM(g.forecastAt)} geschafft`;
    items.push({ id: `goal-${g.id}`, text, group: g.group || null });
  });

  const teams = (data?.teams?.daily?.amount?.entries || []).slice().sort((a, b) => num(b.total) - num(a.total));
  if (teams.length >= 2) {
    const [a, b] = teams;
    const diff = num(a.total) - num(b.total);
    items.push({
      id: `team-${a.groupId}-${b.groupId}`,
      text: diff > 0 ? `${b.name} nur noch ${money(diff)} hinter ${a.name}` : `${a.name} und ${b.name} gleichauf`,
      group: b,
    });
  } else if (teams.length === 1) {
    items.push({ id: `team-${teams[0].groupId}`, text: `${teams[0].name} führt die Team-Wertung an`, group: teams[0] });
  }

  const day = data?.stats?.day;
  if (num(day?.count) > 0) items.push({ id: 'fact-count', text: `Heute schon ${fmtNumber(day.count)} Artikel verkauft` });
  if (num(day?.customers) > 1) items.push({ id: 'fact-customers', text: `${fmtNumber(day.customers)} Gäste haben heute schon mitgespielt` });
  const rec = data?.stats?.recordDay;
  if (rec && num(rec.amount) > 0) {
    // recordDay schließt den laufenden Tag ein
    const ds = data?.period?.dayStart ? new Date(data.period.dayStart) : null;
    const todayKey = ds ? `${ds.getFullYear()}-${String(ds.getMonth() + 1).padStart(2, '0')}-${String(ds.getDate()).padStart(2, '0')}` : null;
    const text = rec.date === todayKey
      ? `Heute ist Rekordabend: schon ${money(rec.amount)} – so viel wie noch nie!`
      : `Rekordabend: ${money(rec.amount)} am ${dateDE(rec.date)}`;
    items.push({ id: 'fact-record', text });
  }
  const w = lastArchive?.amount?.entries?.[0];
  if (w) items.push({ id: `fact-archive-${lastArchive.id}`, text: `Jahressieger ${dateDE(lastArchive.periodStart)} – ${dateDE(lastArchive.periodEnd)}: ${w.customerNickname || w.customerName} mit ${money(w.score)}` });

  if (!items.length) items.push({ id: 'fact-empty', text: 'Clubscore – jeder Kauf zählt!' });
  return items;
}
