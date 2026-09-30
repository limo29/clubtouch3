const crypto = require('crypto');
const prisma = require('../utils/prisma');
const { Prisma } = require('@prisma/client');
const { emitHighscoreUpdate, emitHighscoreDisplay } = require('../utils/websocket');
const {
  BUSINESS_DAY_START_HOUR,
  businessDayWindow,
  businessDayLabel,
  formatLocalDate,
} = require('../utils/businessDay');

// Alles, was die Clubscore-Anzeigen brauchen (Boards, Teams, Ziele, Statistik), wird in einem
// Rutsch berechnet und kurz gecacht: Public-Display, Clubscore-Seite und jeder Verkauf fragten
// sonst je mehrere Full-Scans an.
const BOARD_CACHE_TTL_MS = 5000;
const DISPLAY_COUNT = 20;
const EVENTS_MAX = 20;
const OVERTAKE_TOP = 10;
const RECORD_TTL_MS = 10 * 60 * 1000;
const FORECAST_MIN_MS = 10 * 60 * 1000;

const GOAL_KINDS = ['ARTICLE', 'CATEGORY', 'REVENUE'];
const MAX_GOALS = 6;
const MAX_TEMPLATES = 20;

const SETTING_GOALS = 'clubscore.goals';
const SETTING_TEMPLATES = 'clubscore.goalTemplates';
const SETTING_DISPLAY = 'clubscore.display';

const DISPLAY_VIEWS = ['amount', 'count', 'teams'];
const DEFAULT_DISPLAY = Object.freeze({
  view: 'rotate',
  rotateViews: ['amount', 'count', 'teams'],
  rotateSeconds: 15,
  board: 'both',
  ticker: true,
});

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const displayName = (c) => (c ? (c.nickname || c.name || '').trim() || c.name : null);
const byName = (a, b) => String(a || '').localeCompare(String(b || ''), 'de');

/** Zeit als SQL-Grenze gegen die naive UTC-Spalte "createdAt" (siehe CLAUDE.md). */
const utcTs = (date) => Prisma.sql`(${date}::timestamptz AT TIME ZONE 'UTC')`;

class HighscoreService {
  constructor() {
    this._boardsCache = { at: 0, data: null, promise: null };
    this._freshChain = Promise.resolve();
    this._events = []; // Ringpuffer, neueste zuerst
    this._baseline = null; // Stand der letzten Berechnung für die Ereignis-Erkennung
    this._recordCache = { at: 0, data: null };
    this._groupsCheck = { ok: false, at: 0 };
    this._archivePromises = new Map(); // Jahr -> Promise (automatische Archivierung nur einmal)
    this._systemUserId = null;
    this._dayTimer = null;
    this._initialized = false;
  }

  /* ================================================================
   * Start / Tageswechsel
   * ================================================================ */

  /** Einmal beim Serverstart: Ausgangsstand ohne Ereignisse, Jahresarchiv prüfen, Timer planen. */
  init() {
    if (this._initialized) return;
    this._initialized = true;
    this.getAllBoards({ fresh: true }).catch((err) => console.error('Clubscore-Start fehlgeschlagen:', err));
    this._scheduleDayRollover();
  }

  /** Timer auf den nächsten Geschäftstagsbeginn (06:00 lokal): neue Tageswertung an alle Anzeigen. */
  _scheduleDayRollover() {
    if (this._dayTimer) clearTimeout(this._dayTimer);
    const { end } = businessDayWindow(new Date());
    const delay = Math.max(1000, end.getTime() + 1 - Date.now() + 500);
    this._dayTimer = setTimeout(async () => {
      this._dayTimer = null;
      // Neuer Tag: keine Vergleiche mit gestern, Laufband leeren
      this._baseline = null;
      this._events = [];
      await this.refreshBoards();
      this._scheduleDayRollover();
    }, delay);
    if (typeof this._dayTimer.unref === 'function') this._dayTimer.unref();
  }

  /* ================================================================
   * Einstellungen / Grundlagen
   * ================================================================ */

  async getSettings() {
    const lastReset = await this._getLastYearlyReset();
    return {
      dailyResetHour: BUSINESS_DAY_START_HOUR, // derselbe Geschäftstag wie Tagesabschluss/Dashboard
      dayLabel: businessDayLabel(),
      displayCount: DISPLAY_COUNT,
      yearlyStart: this._yearlyStartFrom(lastReset),
      lastYearlyReset: lastReset ? { at: lastReset.createdAt, byUserId: lastReset.userId } : null,
    };
  }

  /** Letzter manueller Jahres-Reset (AuditLog-Marke, kein eigenes Schema). */
  async _getLastYearlyReset(before = null) {
    return prisma.auditLog.findFirst({
      where: {
        entityType: 'Highscore',
        action: 'RESET_YEARLY_HIGHSCORE',
        ...(before ? { createdAt: { lt: before } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, userId: true },
    });
  }

  /**
   * Start der Jahreswertung: Kalenderjahresanfang, es sei denn, es gab in diesem
   * Kalenderjahr einen manuellen Reset – dann zählt ab dem Reset-Zeitpunkt.
   */
  _yearlyStartFrom(lastReset, now = new Date()) {
    const jan1 = new Date(now.getFullYear(), 0, 1);
    if (lastReset && lastReset.createdAt > jan1) return lastReset.createdAt;
    return jan1;
  }

  /**
   * Übergangsschutz: Gruppen-Spalten (Migration von CustomerGroup) vorhanden?
   * Positives Ergebnis wird dauerhaft gemerkt, negatives höchstens 10 s.
   */
  async _groupsAvailable() {
    if (this._groupsCheck.ok) return true;
    if (Date.now() - this._groupsCheck.at < 10000) return false;
    const [row] = await prisma.$queryRaw`
      SELECT
        (SELECT COUNT(*) FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = 'Customer'
            AND column_name IN ('groupId', 'isGroupAccount'))::int AS cols,
        (SELECT COUNT(*) FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name = 'CustomerGroup')::int AS tbl`;
    this._groupsCheck = { ok: row.cols === 2 && row.tbl === 1, at: Date.now() };
    return this._groupsCheck.ok;
  }

  async _getSystemUserId() {
    if (this._systemUserId) return this._systemUserId;
    const admin = await prisma.user.findFirst({
      where: { role: 'ADMIN' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    this._systemUserId = admin?.id || null;
    return this._systemUserId;
  }

  /** Einmal pro Berechnung: Reset-Marke, zählende Artikel, aktive Gruppen, Zeitfenster. */
  async _buildContext(now = new Date()) {
    const [lastReset, articles, groupsOk] = await Promise.all([
      this._getLastYearlyReset(),
      prisma.article.findMany({ where: { countsForHighscore: true, active: true }, select: { id: true } }),
      this._groupsAvailable(),
    ]);
    const groups = new Map();
    if (groupsOk) {
      const rows = await prisma.$queryRaw`
        SELECT id, name, color, emoji, "imageUrl" FROM "CustomerGroup" WHERE active = true`;
      rows.forEach((g) => groups.set(g.id, {
        id: g.id, name: g.name, color: g.color, emoji: g.emoji || null, imageUrl: g.imageUrl || null,
      }));
    }
    const day = businessDayWindow(now);
    const yearStart = this._yearlyStartFrom(lastReset, now);
    return {
      now,
      day,
      dayKey: formatLocalDate(day.businessDate),
      yearStart,
      yearManualReset: yearStart.getTime() !== new Date(now.getFullYear(), 0, 1).getTime(),
      articleIds: articles.map((a) => a.id),
      groupsOk,
      groups,
      starts: { DAILY: day.start, YEARLY: yearStart },
    };
  }

  _groupBadge(ctx, groupId) {
    return (groupId && ctx.groups.get(groupId)) || null;
  }

  /* ================================================================
   * Ranglisten
   * ================================================================ */

  /**
   * Pro Kunde Umsatz und Stück im Zeitraum (SALE, nicht storniert, zählende aktive Artikel).
   * Eine Abfrage reicht für Umsatz- und Anzahl-Board sowie die Team-Wertung.
   */
  async _customerScores(ctx, start, end = null) {
    if (!ctx.articleIds.length) return [];
    const groupCols = ctx.groupsOk
      ? Prisma.sql`c."groupId" AS group_id, c."isGroupAccount" AS is_group_account`
      : Prisma.sql`NULL::text AS group_id, false AS is_group_account`;
    const endClause = end ? Prisma.sql`AND t."createdAt" < ${utcTs(end)}` : Prisma.empty;
    const rows = await prisma.$queryRaw`
      SELECT
        c.id                    AS customer_id,
        c.name                  AS customer_name,
        c.nickname              AS customer_nickname,
        ${groupCols},
        SUM(ti."totalPrice")    AS amount,
        SUM(ti.quantity)        AS qty,
        COUNT(DISTINCT t.id)    AS tx_count,
        MAX(t."createdAt")      AS last_at
      FROM "Transaction" t
      JOIN "Customer" c         ON c.id = t."customerId"
      JOIN "TransactionItem" ti ON ti."transactionId" = t.id
      WHERE t."createdAt" >= ${utcTs(start)}
        ${endClause}
        AND t.cancelled = false
        AND t.type = 'SALE'
        AND ti."articleId" IN (${Prisma.join(ctx.articleIds)})
      GROUP BY c.id`;
    return rows.map((r) => ({
      customerId: r.customer_id,
      name: r.customer_name,
      nickname: r.customer_nickname,
      groupId: r.group_id || null,
      isGroupAccount: !!r.is_group_account,
      amount: round2(r.amount),
      qty: round2(r.qty),
      txCount: Number(r.tx_count || 0),
      lastAt: r.last_at ? new Date(r.last_at).getTime() : 0,
    }));
  }

  /**
   * Sortiert und vergibt Ränge mit RANK()-Semantik (Gleichstand = gleicher Rang).
   * Reihenfolge bei Gleichstand: wer den Stand zuerst erreicht hat (letzter Kauf früher), dann Name.
   */
  _rankCustomers(rows, mode) {
    const key = mode === 'AMOUNT' ? 'amount' : 'qty';
    const sorted = rows
      .filter((r) => r[key] > 0)
      .sort((a, b) => b[key] - a[key] || a.lastAt - b.lastAt || byName(a.name, b.name));
    let rank = 0;
    let prevScore = null;
    let aboveScore = null; // Wert der nächstbesseren Rang-Gruppe
    return sorted.map((r, i) => {
      const score = r[key];
      if (score !== prevScore) {
        aboveScore = prevScore;
        rank = i + 1;
        prevScore = score;
      }
      return { row: r, rank, score, gapToPrev: aboveScore === null ? null : round2(aboveScore - score) };
    });
  }

  _boardFromRows(ctx, rows, type, mode, startDate) {
    const entries = this._rankCustomers(rows, mode).slice(0, DISPLAY_COUNT).map(({ row, rank, score, gapToPrev }) => ({
      rank,
      customerId: row.customerId,
      customerName: row.name,
      customerNickname: row.nickname,
      score,
      transactionCount: row.txCount,
      ...(mode === 'AMOUNT' ? { totalItems: row.qty } : { totalAmount: row.amount }),
      group: this._groupBadge(ctx, row.groupId),
      isGroupAccount: row.isGroupAccount,
      gapToPrev,
    }));
    return { type, mode, startDate, entries, lastUpdated: new Date() };
  }

  /**
   * Team-Wertung: gleiche Verkäufe wie die Einzelwertung, gruppiert nach Kundengruppe.
   * total inkl. Gruppenkonto; heads = kaufende Mitglieder ohne Gruppenkonto; perHead = total/heads.
   */
  _teamBoardFromRows(ctx, rows, type, mode, startDate) {
    const key = mode === 'AMOUNT' ? 'amount' : 'qty';
    const byGroup = new Map();
    for (const r of rows) {
      const group = this._groupBadge(ctx, r.groupId);
      if (!group || !(r[key] > 0)) continue;
      if (!byGroup.has(group.id)) byGroup.set(group.id, { group, total: 0, heads: 0, top: null });
      const t = byGroup.get(group.id);
      t.total += r[key];
      if (!r.isGroupAccount) {
        t.heads += 1;
        if (!t.top || r[key] > t.top[key] || (r[key] === t.top[key] && (r.lastAt < t.top.lastAt
          || (r.lastAt === t.top.lastAt && byName(r.name, t.top.name) < 0)))) {
          t.top = r;
        }
      }
    }
    const teams = [...byGroup.values()]
      .map((t) => ({ ...t, total: round2(t.total), perHead: t.heads ? round2(t.total / t.heads) : null }))
      .filter((t) => t.total > 0)
      .sort((a, b) => b.total - a.total || byName(a.group.name, b.group.name));

    // Pro-Kopf-Rang (RANK-Semantik) nur für Gruppen mit mindestens einem kaufenden Mitglied
    const perHeadRanks = new Map();
    const ph = teams.filter((t) => t.perHead !== null).sort((a, b) => b.perHead - a.perHead);
    ph.forEach((t, i) => {
      const prev = ph[i - 1];
      perHeadRanks.set(t.group.id, prev && prev.perHead === t.perHead ? perHeadRanks.get(prev.group.id) : i + 1);
    });

    let rank = 0;
    let prevTotal = null;
    const entries = teams.map((t, i) => {
      if (t.total !== prevTotal) { rank = i + 1; prevTotal = t.total; }
      return {
        rank,
        groupId: t.group.id,
        name: t.group.name,
        color: t.group.color,
        emoji: t.group.emoji,
        imageUrl: t.group.imageUrl,
        total: t.total,
        heads: t.heads,
        perHead: t.perHead,
        perHeadRank: t.perHead === null ? null : perHeadRanks.get(t.group.id),
        topMember: t.top ? { customerId: t.top.customerId, name: displayName(t.top) } : null,
      };
    });
    return { type, mode, startDate, entries };
  }

  _boardsForPeriod(ctx, rows, type, startDate) {
    return {
      boards: {
        amount: this._boardFromRows(ctx, rows, type, 'AMOUNT', startDate),
        count: this._boardFromRows(ctx, rows, type, 'COUNT', startDate),
      },
      teams: {
        amount: this._teamBoardFromRows(ctx, rows, type, 'AMOUNT', startDate),
        count: this._teamBoardFromRows(ctx, rows, type, 'COUNT', startDate),
      },
    };
  }

  /**
   * Einzelnes Board. `range` ({ start, end }) überschreibt das Standardfenster
   * (für die automatische Jahresarchivierung abgeschlossener Jahre).
   */
  async calculateHighscore(type = 'DAILY', mode = 'AMOUNT', ctx = null, range = null) {
    const c = ctx || await this._buildContext();
    const start = range?.start || c.starts[type];
    const rows = await this._customerScores(c, start, range?.end || null);
    return this._boardFromRows(c, rows, type, mode, start);
  }

  async getBoard(type, mode) {
    const all = await this.getAllBoards();
    return all[type === 'YEARLY' ? 'yearly' : 'daily'][mode === 'COUNT' ? 'count' : 'amount'];
  }

  async getCustomerPosition(customerId, type = 'DAILY', mode = 'AMOUNT') {
    if (!['DAILY', 'YEARLY'].includes(type)) throw new Error('Ungültiger Typ');
    if (!['AMOUNT', 'COUNT'].includes(mode)) throw new Error('Ungültiger Modus');
    const ctx = await this._buildContext();
    const ranked = this._rankCustomers(await this._customerScores(ctx, ctx.starts[type]), mode);
    const hit = ranked.find((r) => r.row.customerId === customerId);
    if (!hit) return null;
    return {
      customerId,
      customerName: hit.row.name,
      customerNickname: hit.row.nickname,
      type,
      mode,
      score: hit.score,
      rank: hit.rank,
      gapToPrev: hit.gapToPrev,
      participants: ranked.length,
    };
  }

  /* ================================================================
   * Gesamtobjekt (Boards, Teams, Ziele, Ereignisse, Statistik)
   * ================================================================ */

  /**
   * Komplettes Clubscore-Objekt (siehe Vertrag). Ergebnis BOARD_CACHE_TTL_MS lang gecacht,
   * parallele Aufrufer teilen sich eine laufende Berechnung. `fresh` erzwingt Neuberechnung
   * (nach Verkauf/Storno/Reset) inkl. Ereignis-Erkennung; frische Läufe sind serialisiert,
   * damit zwei schnelle Verkäufe nicht gegen denselben Vorher-Stand verglichen werden.
   * `trigger` = { customer, userId } des auslösenden Verkaufs (für GOAL_REACHED.reachedBy).
   */
  async getAllBoards({ fresh = false, trigger = null } = {}) {
    if (!fresh) {
      const now = Date.now();
      if (this._boardsCache.data && now - this._boardsCache.at < BOARD_CACHE_TTL_MS) {
        return this._withLive(this._boardsCache.data);
      }
      if (this._boardsCache.promise) return this._withLive(await this._boardsCache.promise);
    }
    const run = () => this._compute({ fresh, trigger });
    const promise = fresh ? (this._freshChain = this._freshChain.catch(() => {}).then(run)) : run();
    this._boardsCache.promise = promise;
    try {
      const data = await promise;
      this._boardsCache = { at: Date.now(), data, promise: null };
      return this._withLive(data);
    } catch (err) {
      if (this._boardsCache.promise === promise) this._boardsCache.promise = null;
      throw err;
    }
  }

  _withLive(data) {
    return { ...data, events: this._events.slice(), serverTime: new Date().toISOString() };
  }

  async _compute({ fresh, trigger }) {
    const ctx = await this._buildContext();
    await this._ensureYearArchived(ctx).catch((err) => console.error('Automatische Jahresarchivierung fehlgeschlagen:', err));

    const [dayRows, yearRows, goalsResult, stats] = await Promise.all([
      this._customerScores(ctx, ctx.starts.DAILY),
      this._customerScores(ctx, ctx.starts.YEARLY),
      this._goalsProgress(ctx),
      this._stats(ctx),
    ]);
    const day = this._boardsForPeriod(ctx, dayRows, 'DAILY', ctx.starts.DAILY);
    const year = this._boardsForPeriod(ctx, yearRows, 'YEARLY', ctx.starts.YEARLY);

    const data = {
      daily: day.boards,
      yearly: year.boards,
      teams: { daily: day.teams, yearly: year.teams },
      goals: goalsResult.progress,
      stats,
      period: {
        dayStart: ctx.day.start.toISOString(),
        dayLabel: businessDayLabel(),
        yearStart: ctx.yearStart.toISOString(),
        yearManualReset: ctx.yearManualReset,
      },
    };
    await this._detectEvents(ctx, data, goalsResult, { fresh, trigger });
    return data;
  }

  /** Tageszahlen (alle Verkäufe, auch anonyme) und Rekordabend über alle Geschäftstage. */
  async _stats(ctx) {
    const [[row], record] = await Promise.all([
      prisma.$queryRaw`
        SELECT COALESCE(SUM(ti."totalPrice"), 0) AS amount,
               COALESCE(SUM(ti.quantity), 0)     AS qty,
               COUNT(DISTINCT t."customerId")    AS customers
        FROM "Transaction" t
        JOIN "TransactionItem" ti ON ti."transactionId" = t.id
        WHERE t.type = 'SALE' AND t.cancelled = false
          AND t."createdAt" >= ${utcTs(ctx.day.start)}`,
      this._recordDay(),
    ]);
    const dayStats = { amount: round2(row.amount), count: round2(row.qty), customers: Number(row.customers || 0) };
    let recordDay = record;
    if (dayStats.amount > 0 && (!recordDay || dayStats.amount > recordDay.amount)) {
      recordDay = { date: ctx.dayKey, amount: dayStats.amount };
    }
    return { day: dayStats, recordDay };
  }

  /** Umsatzstärkster Geschäftstag (lokale Zeit − 6 h), 10 min gecacht. */
  async _recordDay() {
    if (this._recordCache.data !== null && Date.now() - this._recordCache.at < RECORD_TTL_MS) {
      return this._recordCache.data || null;
    }
    const tz = process.env.TZ || 'Europe/Berlin';
    const rows = await prisma.$queryRaw`
      SELECT to_char(((t."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz})
                     - make_interval(hours => ${BUSINESS_DAY_START_HOUR}::int), 'YYYY-MM-DD') AS d,
             SUM(t."totalAmount") AS amount
      FROM "Transaction" t
      WHERE t.type = 'SALE' AND t.cancelled = false
      GROUP BY 1
      ORDER BY amount DESC
      LIMIT 1`;
    const r = rows[0];
    const data = r && Number(r.amount) > 0 ? { date: r.d, amount: round2(r.amount) } : false;
    this._recordCache = { at: Date.now(), data };
    return data || null;
  }

  /* ================================================================
   * Ereignisse (Laufband / Overlays)
   * ================================================================ */

  _pushEvents(events) {
    if (!events.length) return;
    this._events = [...events, ...this._events].slice(0, EVENTS_MAX);
  }

  _makeEvent(kind, level, title, text, customer = null, group = null) {
    return { id: crypto.randomUUID(), at: new Date().toISOString(), kind, level, title, text, customer, group };
  }

  _goalSignature(g) {
    return [g.id, g.kind, g.articleId || '', (g.category || '').toLowerCase(), g.groupId || '', g.target].join('|');
  }

  /** Höchste Stufe je Ziel merken, ohne Ereignis (neue Ziele, Läufe ohne Verkauf). */
  _mergeGoalMax(prev, goals, goalLevel) {
    const m = new Map(prev);
    goals.forEach((g) => {
      const sig = this._goalSignature(g);
      m.set(sig, Math.max(m.get(sig) || 0, goalLevel(g)));
    });
    return m;
  }

  _uniqueLeader(board) {
    const e = board.entries;
    if (!e.length || (e[1] && e[1].rank === 1)) return null;
    return e[0];
  }

  /**
   * Vergleicht den neuen Stand mit dem vorherigen. Beim ersten Rechnen, nach Tageswechsel
   * oder Jahres-Reset wird nur der Ausgangsstand gemerkt. Nicht-frische Läufe (Abfragen)
   * setzen höchstens den Ausgangsstand, damit kein Verkauf "verbraucht" wird; Meldungen
   * entstehen nur bei Läufen nach einem Verkauf (`trigger`).
   */
  async _detectEvents(ctx, data, goalsResult, { fresh, trigger }) {
    const snap = {
      dayKey: ctx.dayKey,
      yearKey: ctx.yearStart.toISOString(),
      daily: data.daily.amount.entries,
      dayLeader: this._uniqueLeader(data.daily.amount)?.customerId || null,
      yearLeader: this._uniqueLeader(data.yearly.amount)?.customerId || null,
      teamLeader: this._uniqueLeader(data.teams.daily.amount)?.groupId || null,
    };
    const goalLevel = (g) => (data.goals.movingTargets ? g.level : Math.min(g.level, 1));
    const b = this._baseline;

    if (!b || b.dayKey !== snap.dayKey || b.yearKey !== snap.yearKey) {
      if (b && b.dayKey !== snap.dayKey) this._events = [];
      const goalMax = new Map();
      data.goals.goals.forEach((g) => {
        goalMax.set(this._goalSignature(g), Math.max(goalLevel(g), goalsResult.loggedLevels.get(this._goalSignature(g)) || 0));
      });
      this._baseline = { ...snap, goalMax };
      return;
    }
    // Nur Verkäufe lösen Meldungen aus. Storno, Stammdaten- oder Zieländerungen aktualisieren
    // lediglich den Vergleichsstand (sonst "überholt" jeder den Stornierten).
    if (!fresh || !trigger) {
      if (fresh) this._baseline = { ...snap, goalMax: this._mergeGoalMax(b.goalMax, data.goals.goals, goalLevel) };
      return;
    }

    const events = [];
    const entryById = new Map(snap.daily.map((e) => [e.customerId, e]));
    const customerOf = (e) => ({ id: e.customerId, name: displayName({ name: e.customerName, nickname: e.customerNickname }) });

    // Neue Nummer 1 (Tag / Jahr, Umsatz)
    const handled = new Set();
    if (snap.dayLeader && snap.dayLeader !== b.dayLeader) {
      const e = entryById.get(snap.dayLeader);
      handled.add(snap.dayLeader);
      events.push(this._makeEvent('NEW_LEADER_DAY', 'big', 'Neue Nummer 1 des Tages',
        `${customerOf(e).name} übernimmt Platz 1 des Tages!`, customerOf(e), e.group));
    }
    if (snap.yearLeader && snap.yearLeader !== b.yearLeader) {
      const e = data.yearly.amount.entries[0];
      events.push(this._makeEvent('NEW_LEADER_YEAR', 'big', 'Neue Nummer 1 des Jahres',
        `${customerOf(e).name} übernimmt Platz 1 des Jahres!`, customerOf(e), e.group));
    }

    // Überholen in den Top 10 des Tages (Umsatz)
    const prevRank = new Map(b.daily.map((e) => [e.customerId, e.rank]));
    for (const e of snap.daily) {
      if (e.rank > OVERTAKE_TOP) break;
      if (handled.has(e.customerId)) continue;
      const pr = prevRank.get(e.customerId);
      let victim = null;
      for (const p of b.daily) {
        if (p.customerId === e.customerId) continue;
        if (pr !== undefined && !(p.rank < pr)) continue; // war vorher nicht vor ihm
        const now = entryById.get(p.customerId);
        if (!now || now.rank <= e.rank) continue; // jetzt nicht hinter ihm
        if (!victim || now.rank < victim.rank) victim = now;
      }
      if (victim) {
        handled.add(e.customerId);
        events.push(this._makeEvent('OVERTAKE', 'medium', 'Überholt!',
          `${customerOf(e).name} überholt ${customerOf(victim).name} – jetzt Platz ${e.rank}`, customerOf(e), e.group));
      }
    }

    // Neu in den Top 20 des Tages
    for (const e of snap.daily) {
      if (prevRank.has(e.customerId) || handled.has(e.customerId)) continue;
      events.push(this._makeEvent('NEW_TOP20', 'medium', 'Neu in den Top 20',
        `${customerOf(e).name} steigt auf Platz ${e.rank} ein`, customerOf(e), e.group));
    }

    // Team übernimmt die Tagesführung
    if (snap.teamLeader && snap.teamLeader !== b.teamLeader) {
      const group = this._groupBadge(ctx, snap.teamLeader);
      if (group) {
        events.push(this._makeEvent('TEAM_LEAD_DAY', 'big', 'Neue Tagesführung',
          `Team ${group.name} übernimmt die Tagesführung!`, null, group));
      }
    }

    // Ziele (bei mitwachsenden Zielen jede Stufe); jede Stufe nur einmal pro Tag
    const goalMax = new Map(b.goalMax);
    const reachedBy = trigger?.customer ? { customerId: trigger.customer.id, name: displayName(trigger.customer) } : null;
    for (const g of data.goals.goals) {
      const sig = this._goalSignature(g);
      const level = goalLevel(g);
      if (!goalMax.has(sig)) { goalMax.set(sig, level); continue; } // neues/geändertes Ziel: kein Ereignis
      if (level <= goalMax.get(sig)) continue;
      goalMax.set(sig, level);
      const nowIso = new Date().toISOString();
      g.reachedAt = nowIso;
      g.reachedBy = reachedBy;
      data.goals.monthReached += 1;
      const stage = level > 1 ? ` (Stufe ${level})` : '';
      const title = g.group ? `Team ${g.group.name} hat es geschafft!` : 'Ziel erreicht!';
      const text = reachedBy ? `${reachedBy.name} knackt „${g.label}“${stage}!` : `„${g.label}“${stage} ist geschafft!`;
      events.push(this._makeEvent('GOAL_REACHED', 'big', title, text,
        reachedBy ? { id: reachedBy.customerId, name: reachedBy.name } : null, g.group));
      try {
        const userId = trigger?.userId || await this._getSystemUserId();
        if (userId) {
          await prisma.auditLog.create({
            data: {
              userId,
              action: 'GOAL_REACHED',
              entityType: 'HighscoreGoal',
              entityId: g.id,
              changes: { label: g.label, level, target: g.target, current: g.current, businessDate: ctx.dayKey, customer: reachedBy },
            },
          });
        }
      } catch (err) {
        console.error('GOAL_REACHED konnte nicht protokolliert werden:', err);
      }
    }

    this._baseline = { ...snap, goalMax };
    this._pushEvents(events);
  }

  /* ================================================================
   * Ziele
   * ================================================================ */

  async _readSetting(key) {
    const row = await prisma.systemSetting.findUnique({ where: { key } });
    if (!row) return null;
    try { return JSON.parse(row.value); } catch { return null; }
  }

  async _writeSetting(key, value, description) {
    const json = JSON.stringify(value);
    await prisma.systemSetting.upsert({
      where: { key },
      update: { value: json },
      create: { key, value: json, description },
    });
  }

  /** Bereinigt ein Ziel (Validierung passiert vorher in middleware/highscoreValidation.js). */
  normalizeGoal(g, { keepId = true } = {}) {
    const kind = GOAL_KINDS.includes(g?.kind) ? g.kind : 'ARTICLE';
    const target = Number(g?.target ?? g?.targetUnits);
    const id = keepId && typeof g?.id === 'string' && g.id.trim() && g.id.length <= 64 ? g.id.trim() : crypto.randomUUID();
    return {
      id,
      kind,
      articleId: kind === 'ARTICLE' ? String(g.articleId || '') || null : null,
      category: kind === 'CATEGORY' ? String(g.category || '').trim() || null : null,
      groupId: g?.groupId ? String(g.groupId) : null,
      target: kind === 'REVENUE' ? round2(target) : Math.round(target),
      label: String(g?.label || '').trim().slice(0, 60),
    };
  }

  /** Ziele aus SystemSetting; Fallback: letzter AuditLog `HighscoreGoals` (altes Format, nur Artikel). */
  async getGoalsConfig() {
    const stored = await this._readSetting(SETTING_GOALS);
    if (stored && Array.isArray(stored.goals)) {
      return { goals: stored.goals, movingTargets: !!stored.movingTargets };
    }
    const log = await prisma.auditLog.findFirst({
      where: { entityType: 'HighscoreGoals', action: 'SET' },
      orderBy: { createdAt: 'desc' },
    });
    const legacy = Array.isArray(log?.changes?.goals) ? log.changes.goals : [];
    return {
      goals: legacy
        .filter((g) => g && (g.articleId || g.kind) && Number(g.target ?? g.targetUnits) > 0)
        .map((g, i) => this.normalizeGoal({ ...g, id: g.id || `legacy-${i}-${g.articleId || g.kind}` })),
      movingTargets: !!log?.changes?.movingTargets,
    };
  }

  async setGoals(goals, movingTargets) {
    const clean = (goals || []).slice(0, MAX_GOALS).map((g) => this.normalizeGoal(g));
    const config = { goals: clean, movingTargets: !!movingTargets };
    await this._writeSetting(SETTING_GOALS, config, 'Clubscore-Tagesziele');
    const all = await this.getAllBoards({ fresh: true });
    emitHighscoreUpdate(all);
    return { config, progress: all.goals };
  }

  async getGoalsProgress() {
    return (await this.getAllBoards()).goals;
  }

  /** Aktueller Wert und erster passender Verkauf des Geschäftstags für ein Ziel. */
  async _goalCurrent(ctx, goal) {
    const conds = [
      Prisma.sql`t.type = 'SALE'`,
      Prisma.sql`t.cancelled = false`,
      Prisma.sql`t."createdAt" >= ${utcTs(ctx.day.start)}`,
      Prisma.sql`t."createdAt" <= ${utcTs(ctx.day.end)}`,
    ];
    if (goal.kind === 'ARTICLE') conds.push(Prisma.sql`ti."articleId" = ${goal.articleId}`);
    if (goal.kind === 'CATEGORY') conds.push(Prisma.sql`LOWER(a.category) = LOWER(${goal.category})`);
    if (goal.groupId) {
      if (!ctx.groupsOk) return { current: 0, firstAt: null };
      conds.push(Prisma.sql`c."groupId" = ${goal.groupId}`);
    }
    const valueExpr = goal.kind === 'REVENUE' ? Prisma.sql`SUM(ti."totalPrice")` : Prisma.sql`SUM(ti.quantity)`;
    const [row] = await prisma.$queryRaw`
      SELECT COALESCE(${valueExpr}, 0) AS current, MIN(t."createdAt") AS first_at
      FROM "Transaction" t
      JOIN "TransactionItem" ti ON ti."transactionId" = t.id
      ${goal.kind === 'CATEGORY' ? Prisma.sql`JOIN "Article" a ON a.id = ti."articleId"` : Prisma.empty}
      ${goal.groupId ? Prisma.sql`JOIN "Customer" c ON c.id = t."customerId"` : Prisma.empty}
      WHERE ${Prisma.join(conds, ' AND ')}`;
    return { current: round2(row?.current), firstAt: row?.first_at ? new Date(row.first_at) : null };
  }

  /**
   * GoalsProgress laut Vertrag. Liefert zusätzlich `loggedLevels` (höchste heute protokollierte
   * Stufe je Ziel-Signatur) für die Ereignis-Erkennung nach einem Neustart.
   */
  async _goalsProgress(ctx) {
    const cfg = await this.getGoalsConfig();
    const monthStart = new Date(ctx.now.getFullYear(), ctx.now.getMonth(), 1);
    const [monthReached, todayLogs] = await Promise.all([
      prisma.auditLog.count({
        where: { entityType: 'HighscoreGoal', action: 'GOAL_REACHED', createdAt: { gte: monthStart } },
      }),
      cfg.goals.length
        ? prisma.auditLog.findMany({
          where: { entityType: 'HighscoreGoal', action: 'GOAL_REACHED', createdAt: { gte: ctx.day.start } },
          orderBy: { createdAt: 'desc' },
        })
        : [],
    ]);
    const loggedLevels = new Map();
    if (!cfg.goals.length) return { progress: { movingTargets: cfg.movingTargets, goals: [], monthReached }, loggedLevels };

    const articleIds = cfg.goals.filter((g) => g.articleId).map((g) => g.articleId);
    const [articles, currents] = await Promise.all([
      articleIds.length
        ? prisma.article.findMany({
          where: { id: { in: articleIds } },
          select: { id: true, name: true, unitsPerPurchase: true, purchaseUnit: true, unit: true },
        })
        : [],
      Promise.all(cfg.goals.map((g) => this._goalCurrent(ctx, g))),
    ]);
    const aMap = new Map(articles.map((a) => [a.id, a]));
    const nowMs = ctx.now.getTime();

    const goals = cfg.goals.map((g, i) => {
      const a = g.articleId ? aMap.get(g.articleId) : null;
      const target = Number(g.target);
      const { current, firstAt } = currents[i];
      const level = target > 0 ? Math.floor(current / target + 1e-9) : 0;
      const displayTarget = cfg.movingTargets ? target * (level + 1) : target;
      const reached = current >= target;
      const step = a ? Math.max(1, Number(a.unitsPerPurchase || 1)) : 1;

      // Lineare Hochrechnung ab dem ersten passenden Verkauf des Tages
      let forecastAt = null;
      const nextTarget = cfg.movingTargets ? displayTarget : (reached ? null : target);
      if (nextTarget && current > 0 && firstAt && nowMs - firstAt.getTime() >= FORECAST_MIN_MS) {
        const rate = current / (nowMs - firstAt.getTime());
        const eta = nowMs + (nextTarget - current) / rate;
        if (eta <= ctx.day.end.getTime()) forecastAt = new Date(eta).toISOString();
      }

      // Letzte heute protokollierte Stufe dieses Ziels (gleiches Ziel = gleiche id und gleicher Zielwert)
      const logs = todayLogs.filter((l) => l.entityId === g.id && Number(l.changes?.target) === target);
      const sig = this._goalSignature(g);
      loggedLevels.set(sig, logs.reduce((m, l) => Math.max(m, Number(l.changes?.level) || 0), 0));
      const latest = reached ? logs[0] : null;

      const defaultLabel = g.kind === 'ARTICLE' ? (a?.name || 'Artikel')
        : g.kind === 'CATEGORY' ? g.category : 'Tagesumsatz';
      return {
        id: g.id,
        kind: g.kind,
        articleId: g.articleId || null,
        category: g.category || null,
        groupId: g.groupId || null,
        target,
        label: g.label || defaultLabel,
        articleName: a?.name || null,
        unitsPerPurchase: step,
        purchaseUnit: a ? (a.purchaseUnit || a.unit || 'Stück') : null,
        group: this._groupBadge(ctx, g.groupId),
        current,
        level,
        displayTarget,
        reached,
        forecastAt,
        reachedAt: latest ? latest.createdAt.toISOString() : null,
        reachedBy: latest?.changes?.customer || null,
      };
    });
    return { progress: { movingTargets: cfg.movingTargets, goals, monthReached }, loggedLevels };
  }

  /* ---------- Vorlagen ---------- */

  async getGoalTemplates() {
    const stored = await this._readSetting(SETTING_TEMPLATES);
    return { templates: Array.isArray(stored?.templates) ? stored.templates : [] };
  }

  async setGoalTemplates(templates) {
    const clean = (templates || []).slice(0, MAX_TEMPLATES).map((t) => ({
      name: String(t.name || '').trim().slice(0, 60),
      goals: (Array.isArray(t.goals) ? t.goals : []).slice(0, MAX_GOALS).map((g) => this.normalizeGoal(g)),
      movingTargets: !!t.movingTargets,
    }));
    await this._writeSetting(SETTING_TEMPLATES, { templates: clean }, 'Clubscore-Zielvorlagen');
    return { templates: clean };
  }

  /* ---------- Anzeige-Einstellung ---------- */

  _normalizeDisplay(input, base = DEFAULT_DISPLAY) {
    const d = { ...DEFAULT_DISPLAY, ...base };
    const src = input || {};
    if (['amount', 'count', 'teams', 'rotate'].includes(src.view)) d.view = src.view;
    if (Array.isArray(src.rotateViews)) {
      const views = DISPLAY_VIEWS.filter((v) => src.rotateViews.includes(v));
      if (views.length) d.rotateViews = views;
    }
    const secs = Number(src.rotateSeconds);
    if (Number.isFinite(secs)) d.rotateSeconds = Math.min(120, Math.max(5, Math.round(secs)));
    if (['both', 'day', 'year'].includes(src.board)) d.board = src.board;
    if (typeof src.ticker === 'boolean') d.ticker = src.ticker;
    return d;
  }

  async getDisplay() {
    return this._normalizeDisplay(await this._readSetting(SETTING_DISPLAY));
  }

  async setDisplay(input) {
    const display = this._normalizeDisplay(input, await this.getDisplay());
    await this._writeSetting(SETTING_DISPLAY, display, 'Clubscore-Anzeige für alle Bildschirme');
    emitHighscoreDisplay(display);
    return display;
  }

  /* ================================================================
   * Aktualisierung nach Verkauf / Storno / Stammdaten
   * ================================================================ */

  /** Alles frisch rechnen und pushen (Storno, Stammdaten-Änderung, Ziele, Tageswechsel). */
  async refreshBoards() {
    try {
      const data = await this.getAllBoards({ fresh: true });
      emitHighscoreUpdate(data);
      return data;
    } catch (err) {
      console.error('Error refreshing highscore:', err);
      return null;
    }
  }

  /**
   * Nach jedem Verkauf (nur type SALE). Immer frisch rechnen: Ziele ohne Gruppe zählen auch
   * anonyme Verkäufe und Artikel ohne countsForHighscore, und die Verkaufsfrequenz ist niedrig.
   */
  async updateAfterSale(transactionId) {
    try {
      const transaction = await prisma.transaction.findUnique({
        where: { id: transactionId },
        select: {
          type: true,
          cancelled: true,
          userId: true,
          customer: { select: { id: true, name: true, nickname: true } },
        },
      });
      if (!transaction || transaction.type !== 'SALE' || transaction.cancelled) return;
      const data = await this.getAllBoards({
        fresh: true,
        trigger: { customer: transaction.customer, userId: transaction.userId },
      });
      emitHighscoreUpdate(data);
    } catch (err) {
      console.error('Error updating highscore:', err);
    }
  }

  /* ================================================================
   * Jahres-Reset und Archiv
   * ================================================================ */

  async resetHighscore(type, userId) {
    if (type !== 'YEARLY') {
      throw new Error('Nur der Jahres-Highscore kann manuell zurückgesetzt werden');
    }
    // Stand vor dem Reset in beiden Modi (inkl. Teams) archivieren; der AuditLog-Eintrag ist
    // zugleich die Startmarke der neuen Jahreswertung (siehe _yearlyStartFrom).
    const ctx = await this._buildContext();
    const rows = await this._customerScores(ctx, ctx.starts.YEARLY);
    const year = this._boardsForPeriod(ctx, rows, 'YEARLY', ctx.starts.YEARLY);
    const created = await prisma.auditLog.create({
      data: {
        userId, action: 'RESET_YEARLY_HIGHSCORE', entityType: 'Highscore', entityId: 'yearly',
        changes: {
          periodStart: ctx.starts.YEARLY,
          periodEnd: new Date(),
          archivedHighscore: year.boards.amount,
          archivedHighscoreCount: year.boards.count,
          archivedTeams: { amount: { entries: year.teams.amount.entries }, count: { entries: year.teams.count.entries } },
        },
      },
    });

    // Neue Jahreswertung: keine Vergleiche mit dem alten Stand
    this._baseline = null;
    const data = await this.getAllBoards({ fresh: true });
    emitHighscoreUpdate({ ...data, reset: true, resetType: 'YEARLY' });
    return { resetAt: created.createdAt, archivedEntries: year.boards.amount.entries.length };
  }

  /**
   * Automatischer Jahreswechsel: Fehlt für das abgeschlossene Vorjahr (mit Verkäufen) ein
   * Archiv-Eintrag, wird er einmalig als ARCHIVE_YEARLY_HIGHSCORE geschrieben.
   * periodStart = max(1.1., letzter manueller Reset in dem Jahr), periodEnd = 1.1. des Folgejahres.
   */
  _ensureYearArchived(ctx) {
    const year = ctx.now.getFullYear() - 1;
    if (!this._archivePromises.has(year)) {
      const p = this._archiveYear(ctx, year).catch((err) => {
        this._archivePromises.delete(year); // beim nächsten Mal erneut versuchen
        throw err;
      });
      this._archivePromises.set(year, p);
    }
    return this._archivePromises.get(year);
  }

  async _archiveYear(ctx, year) {
    const entityId = String(year);
    const exists = await prisma.auditLog.findFirst({
      where: { entityType: 'Highscore', action: 'ARCHIVE_YEARLY_HIGHSCORE', entityId },
      select: { id: true },
    });
    if (exists) return;

    const jan1 = new Date(year, 0, 1);
    const periodEnd = new Date(year + 1, 0, 1);
    const lastReset = await this._getLastYearlyReset(periodEnd);
    const periodStart = lastReset && lastReset.createdAt > jan1 ? lastReset.createdAt : jan1;
    const rows = await this._customerScores(ctx, periodStart, periodEnd);
    if (!rows.length) return; // keine zählenden Verkäufe → nichts zu archivieren

    const archived = this._boardsForPeriod(ctx, rows, 'YEARLY', periodStart);
    const userId = await this._getSystemUserId();
    if (!userId) return;
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'ARCHIVE_YEARLY_HIGHSCORE',
        entityType: 'Highscore',
        entityId,
        changes: {
          periodStart,
          periodEnd,
          archivedHighscore: archived.boards.amount,
          archivedHighscoreCount: archived.boards.count,
          archivedTeams: {
            amount: { entries: archived.teams.amount.entries },
            count: { entries: archived.teams.count.entries },
          },
        },
      },
    });
    console.log(`🏆 Clubscore ${year} automatisch archiviert`);
  }

  /**
   * Archiv der Jahreswertungen: manuelle Resets (RESET_YEARLY_HIGHSCORE, Stand vor dem Reset)
   * und automatische Jahresabschlüsse (ARCHIVE_YEARLY_HIGHSCORE). Neueste zuerst.
   * `top` kürzt die Einträge (Public-Display: 3), sonst voller Top-20-Stand.
   */
  async getArchive({ top = null, limit = 24 } = {}) {
    try {
      await this._ensureYearArchived(await this._buildContext());
    } catch (err) {
      console.error('Automatische Jahresarchivierung fehlgeschlagen:', err);
    }
    const rows = await prisma.auditLog.findMany({
      where: { entityType: 'Highscore', action: { in: ['RESET_YEARLY_HIGHSCORE', 'ARCHIVE_YEARLY_HIGHSCORE'] } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { user: { select: { name: true } } },
    });
    const cut = (arr) => (top ? (arr || []).slice(0, top) : (arr || []));
    return rows
      .map((r) => {
        const auto = r.action === 'ARCHIVE_YEARLY_HIGHSCORE';
        const ch = r.changes || {};
        const amount = ch.archivedHighscore || {};
        const count = ch.archivedHighscoreCount || {};
        return {
          id: r.id,
          auto,
          periodStart: ch.periodStart || amount.startDate || null,
          periodEnd: ch.periodEnd || r.createdAt,
          resetAt: auto ? null : r.createdAt,
          resetBy: auto ? null : (r.user?.name || null),
          entriesCount: (amount.entries || []).length,
          amount: { entries: cut(amount.entries) },
          count: { entries: cut(count.entries) },
          ...(ch.archivedTeams ? {
            teams: {
              amount: { entries: cut(ch.archivedTeams.amount?.entries) },
              count: { entries: cut(ch.archivedTeams.count?.entries) },
            },
          } : {}),
        };
      })
      .sort((a, b) => new Date(b.periodEnd) - new Date(a.periodEnd))
      .slice(0, limit);
  }

  /* Customer Achievements – bewusst unverändert */
  async getCustomerAchievements(customerId) {
    const achievements = [];
    const [
      totalTransactions,
      totalSpent,
      favoriteArticle,
    ] = await Promise.all([
      prisma.transaction.count({ where: { customerId, cancelled: false, type: 'SALE' } }),
      prisma.transaction.aggregate({ where: { customerId, cancelled: false, type: 'SALE' }, _sum: { totalAmount: true } }),
      prisma.$queryRaw`
        SELECT a.name, COUNT(*) as count
        FROM "TransactionItem" ti
        JOIN "Transaction" t ON ti."transactionId" = t.id
        JOIN "Article" a ON ti."articleId" = a.id
        WHERE t."customerId" = ${customerId} AND t.cancelled = false AND t.type = 'SALE'
        GROUP BY a.id, a.name
        ORDER BY count DESC
        LIMIT 1
      `,
    ]);

    if (totalTransactions >= 100) achievements.push({ id: 'century', name: 'Jahrhundert-Kunde', description: '100 Einkäufe getätigt', icon: '💯' });
    if (totalTransactions >= 10) achievements.push({ id: 'regular', name: 'Stammkunde', description: '10 Einkäufe getätigt', icon: '⭐' });
    if (Number(totalSpent._sum.totalAmount || 0) >= 500) achievements.push({ id: 'big_spender', name: 'Großzügig', description: '500€ ausgegeben', icon: '💰' });
    if (favoriteArticle.length && Number(favoriteArticle[0].count) >= 50) achievements.push({ id: 'loyal_fan', name: `${favoriteArticle[0].name}-Fan`, description: `50x ${favoriteArticle[0].name} gekauft`, icon: '❤️' });
    return achievements;
  }
}

const service = new HighscoreService();
service.GOAL_KINDS = GOAL_KINDS;
service.MAX_GOALS = MAX_GOALS;
service.MAX_TEMPLATES = MAX_TEMPLATES;
service.DISPLAY_VIEWS = DISPLAY_VIEWS;
module.exports = service;
