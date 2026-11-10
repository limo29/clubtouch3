/**
 * Kunden: Liste mit Filter (Standard: aktive Kunden), Sortierung und Suche – die Leiste bleibt beim Scrollen stehen.
 * Desktop: Tabelle mit „Aufladen“ je Zeile. Handy/Tablet: kompakte Kartenliste.
 * Zeile antippen öffnet das Kunden-Panel (Konto mit Verlauf · Daten).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Avatar, Box, Button, Card, Chip, Fab, Grid, InputAdornment, ListItemIcon, Menu, MenuItem, Skeleton,
  Stack, Switch, TextField, Tooltip, Typography, useMediaQuery,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import {
  AccountBalanceWallet, Add, ArrowDownward, ArrowUpward, Check, ChevronRight, Groups, Person, PersonOff, Search,
  Sort, TrendingDown, Warning,
} from '@mui/icons-material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { API_ENDPOINTS } from '../config/api';
import KPICard from '../components/common/KPICard';
import { invalidate } from '../utils/invalidate';
import { useAuth } from '../context/AuthContext';
import { money, num } from '../utils/format';
import GroupBadge from '../components/customers/GroupBadge';
import GroupManagerDialog from '../components/customers/GroupManagerDialog';
import CustomerPanel, { initials } from '../components/customers/CustomerPanel';
import StickyToolbar, { FilterChips } from '../components/common/StickyToolbar';

const LOW = 5; // Grenze „wenig Guthaben“ in €

const FILTERS = [
  { key: 'active', label: 'Aktiv', test: (c) => c.active !== false },
  { key: 'low', label: `Unter ${LOW} €`, test: (c) => c.active !== false && num(c.balance) >= 0 && num(c.balance) < LOW },
  { key: 'negative', label: 'Im Minus', test: (c) => num(c.balance) < 0 },
  { key: 'hidden', label: 'Ausgeblendet', test: (c) => c.active === false },
  { key: 'all', label: 'Alle', test: () => true },
];
const SORTS = [
  { key: 'name', label: 'Name', dir: 1, value: (c) => (c.nickname || c.name).toLowerCase() },
  { key: 'balance', label: 'Guthaben', dir: -1, value: (c) => num(c.balance) },
  { key: 'activity', label: 'Letzte Aktivität', dir: -1, value: (c) => new Date(c.lastActivity || 0).getTime() },
];

/** „heute“, „gestern“, „vor 5 Tagen“, sonst Datum */
const relDate = (d) => {
  if (!d) return '–';
  const date = new Date(d);
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(date).setHours(0, 0, 0, 0)) / 86400000);
  if (days <= 0) return 'heute';
  if (days === 1) return 'gestern';
  if (days < 14) return `vor ${days} Tagen`;
  return date.toLocaleDateString('de-DE');
};

const balanceColor = (c) => (num(c.balance) < 0 ? 'error.main' : c.active !== false && num(c.balance) < LOW ? 'warning.main' : 'text.primary');

function CustomerAvatar({ customer, size = 40 }) {
  return (
    <Box sx={{ position: 'relative', flexShrink: 0 }}>
      <Avatar sx={{ width: size, height: size, fontWeight: 800, fontSize: size * 0.38, bgcolor: 'action.selected', color: 'text.primary' }}>
        {initials(customer.name)}
      </Avatar>
      {customer.group && (
        <Box sx={{ position: 'absolute', right: -4, bottom: -4 }}><GroupBadge group={customer.group} size={size * 0.5} /></Box>
      )}
    </Box>
  );
}

/* ------------------------------ Tabelle ------------------------------ */

const COLS = 'minmax(220px, 2.2fr) 120px minmax(130px, 1fr) 64px 110px 100px 48px';

function HeaderCell({ label, sortKey, sort, onSort, align = 'left' }) {
  const active = sort.key === sortKey;
  const Arrow = sort.dir === 1 ? ArrowUpward : ArrowDownward;
  const content = (
    <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: active ? 'text.primary' : 'text.secondary', display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
      {label}{active && <Arrow sx={{ fontSize: 14 }} />}
    </Typography>
  );
  return (
    <Box sx={{ textAlign: align }}>
      {sortKey ? <Box component="button" type="button" onClick={() => onSort(sortKey)} sx={{ all: 'unset', cursor: 'pointer' }}>{content}</Box> : content}
    </Box>
  );
}

function TableRow({ c, onOpen, onToggle, canEdit }) {
  const hidden = c.active === false;
  return (
    <Box onClick={() => onOpen(c)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(c)}
      sx={{
        display: 'grid', gridTemplateColumns: COLS, gap: 2, alignItems: 'center', px: 2, py: 1.25, cursor: 'pointer',
        borderBottom: '1px solid', borderColor: 'divider', '&:last-of-type': { borderBottom: 'none' },
        '&:hover': { bgcolor: 'action.hover' }, outline: 'none', '&:focus-visible': { bgcolor: 'action.focus' },
      }}>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0, opacity: hidden ? 0.55 : 1 }}>
        <CustomerAvatar customer={c} />
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
            <Typography fontWeight={700} noWrap>{c.name}</Typography>
            {c.isGroupAccount && <Chip size="small" label="Gruppenkonto" sx={{ height: 20, fontSize: '0.7rem' }} />}
            {hidden && <Chip size="small" label="Ausgeblendet" sx={{ height: 20, fontSize: '0.7rem' }} />}
          </Stack>
          {c.nickname && <Typography variant="body2" color="text.secondary" noWrap>„{c.nickname}“</Typography>}
        </Box>
      </Stack>
      <Typography fontWeight={800} sx={{ textAlign: 'right', color: balanceColor(c), fontSize: '1.05rem' }}>{money(c.balance)}</Typography>
      <Box sx={{ minWidth: 0 }}>
        <Typography noWrap>{relDate(c.lastActivity)}</Typography>
        {c.lastActivity && relDate(c.lastActivity).startsWith('vor') && <Typography variant="body2" color="text.secondary">{new Date(c.lastActivity).toLocaleDateString('de-DE')}</Typography>}
      </Box>
      <Typography sx={{ textAlign: 'right' }} color={c._count?.transactions ? 'text.primary' : 'text.secondary'}>{c._count?.transactions || 0}</Typography>
      <Typography color="text.secondary">{new Date(c.createdAt).toLocaleDateString('de-DE')}</Typography>
      <Box sx={{ display: 'flex', justifyContent: 'center' }} onClick={(e) => e.stopPropagation()}>
        <Tooltip title={hidden ? 'Ausgeblendet – erscheint nicht im Verkauf' : 'Wird im Verkauf angezeigt'}>
          <span><Switch checked={!hidden} disabled={!canEdit} onChange={() => onToggle(c)} /></span>
        </Tooltip>
      </Box>
      <ChevronRight sx={{ color: 'text.disabled', justifySelf: 'end' }} />
    </Box>
  );
}

/* ------------------------- Handy: Kartenliste ------------------------ */

function CompactRow({ c, onOpen }) {
  const hidden = c.active === false;
  return (
    <Box onClick={() => onOpen(c)} role="button" tabIndex={0}
      sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 1.25, cursor: 'pointer', borderBottom: '1px solid', borderColor: 'divider', '&:last-of-type': { borderBottom: 'none' }, '&:active': { bgcolor: 'action.hover' } }}>
      <Box sx={{ opacity: hidden ? 0.55 : 1 }}><CustomerAvatar customer={c} size={44} /></Box>
      <Box sx={{ flex: 1, minWidth: 0, opacity: hidden ? 0.6 : 1 }}>
        <Typography fontWeight={700} noWrap>{c.nickname || c.name}</Typography>
        <Typography variant="body2" color="text.secondary" noWrap>
          {[c.nickname && c.name, hidden ? 'ausgeblendet' : null, `zuletzt ${relDate(c.lastActivity)}`].filter(Boolean).join(' · ')}
        </Typography>
      </Box>
      <Typography fontWeight={800} sx={{ color: balanceColor(c), whiteSpace: 'nowrap' }}>{money(c.balance)}</Typography>
      <ChevronRight sx={{ color: 'text.disabled', ml: -0.5 }} />
    </Box>
  );
}

/* -------------------------------- Seite ------------------------------ */

export default function Customers() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const compact = useMediaQuery(theme.breakpoints.down('md'));
  const tableLayout = useMediaQuery(theme.breakpoints.up('lg'));
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canEdit = can('editCustomers');
  const canSeeContact = can('customerContact');

  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [filter, setFilter] = useState('active');
  const [sort, setSort] = useState({ key: 'name', dir: 1 });
  const [sortAnchor, setSortAnchor] = useState(null);
  const [panel, setPanel] = useState({ open: false, id: null, tab: 'account' });
  const [groupManager, setGroupManager] = useState(false);

  // Aufruf mit ?kunde=<id> (z. B. aus Transaktionen): Panel dieses Kunden öffnen, Parameter danach entfernen
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedId = searchParams.get('kunde');
  useEffect(() => {
    if (!linkedId) return;
    setPanel({ open: true, id: linkedId, tab: 'account' });
    setSearchParams({}, { replace: true });
  }, [linkedId, setSearchParams]);

  const { data: groupsData } = useQuery({ queryKey: ['customer-groups'], queryFn: async () => (await api.get(API_ENDPOINTS.CUSTOMER_GROUPS)).data });
  const groups = groupsData?.groups || [];
  // Alle Kunden einmal laden, Suche/Filter/Sortierung im Browser (kein Flackern beim Tippen)
  const { data, isLoading } = useQuery({ queryKey: ['customers', 'all'], queryFn: async () => (await api.get(API_ENDPOINTS.CUSTOMERS)).data });
  const customers = useMemo(() => data?.customers || [], [data]);

  const toggle = useMutation({
    mutationFn: async (c) => api.put(`${API_ENDPOINTS.CUSTOMERS}/${c.id}`, { active: c.active === false }),
    onSuccess: () => invalidate(queryClient, 'customers', 'finance'),
  });

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, customers.filter(f.test).length])), [customers]);
  const sums = useMemo(() => ({
    total: customers.reduce((s, c) => s + num(c.balance), 0),
    negative: customers.filter((c) => num(c.balance) < 0).reduce((s, c) => s + num(c.balance), 0),
    active: customers.filter((c) => c.active !== false).reduce((s, c) => s + num(c.balance), 0),
  }), [customers]);

  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    const f = FILTERS.find((x) => x.key === filter);
    const sd = SORTS.find((x) => x.key === sort.key);
    return customers
      .filter((c) => f.test(c) && (!groupFilter || c.groupId === groupFilter)
        && (!s || c.name.toLowerCase().includes(s) || (c.nickname || '').toLowerCase().includes(s)))
      .sort((a, b) => {
        const va = sd.value(a); const vb = sd.value(b);
        return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir || a.name.localeCompare(b.name, 'de');
      });
  }, [customers, search, filter, groupFilter, sort]);

  // Klick auf den aktiven Filter wählt ihn ab -> alle Kunden
  const pickFilter = (key) => setFilter((f) => (f === key ? 'all' : key));
  const onSort = (key) => setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: SORTS.find((x) => x.key === key).dir }));
  const open = (c, tab = 'account') => setPanel({ open: true, id: c?.id || null, tab });
  // frisch angelegt: bis die Liste neu geladen ist, die Antwort des Servers verwenden
  const panelCustomer = panel.id ? customers.find((c) => c.id === panel.id) || panel.fallback || null : null;
  const sortDef = SORTS.find((x) => x.key === sort.key);

  return (
    <Box sx={{ pb: 10 }}>
      {/* Kennzahlen (ab Desktop) – Klick setzt den Filter */}
      {!compact && (
        <Grid container spacing={2} sx={{ mb: 1 }}>
          <Grid size={{ md: 3 }}>
            <KPICard title="Aktive Kunden" value={counts.active} icon={Person} color="primary" loading={isLoading} onClick={() => pickFilter('active')}
              subTitle={`${counts.hidden} ausgeblendet`} />
          </Grid>
          <Grid size={{ md: 3 }}>
            <KPICard title="Guthaben gesamt" value={money(sums.total)} icon={AccountBalanceWallet} color="success" loading={isLoading} onClick={() => pickFilter('all')}
              subTitle={`davon aktive Kunden ${money(sums.active)}`} />
          </Grid>
          <Grid size={{ md: 3 }}>
            <KPICard title={`Unter ${LOW} €`} value={counts.low} icon={Warning} color="warning" loading={isLoading} onClick={() => pickFilter('low')}
              subTitle="aktive Kunden mit wenig Guthaben" />
          </Grid>
          <Grid size={{ md: 3 }}>
            <KPICard title="Im Minus" value={counts.negative} icon={TrendingDown} color="error" loading={isLoading} onClick={() => pickFilter('negative')}
              subTitle={counts.negative ? `zusammen ${money(sums.negative)}` : 'niemand'} />
          </Grid>
        </Grid>
      )}

      {/* Werkzeugleiste – bleibt unter der App-Leiste stehen */}
      <StickyToolbar>
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <TextField placeholder="Name oder Spitzname suchen…" size="small" fullWidth value={search} onChange={(e) => setSearch(e.target.value)}
                InputProps={{ startAdornment: <InputAdornment position="start"><Search /></InputAdornment> }} sx={{ minWidth: 0 }} />
              {groups.length > 0 && !isMobile && (
                <TextField select size="small" label="Gruppe" value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} sx={{ minWidth: 170, flexShrink: 0 }}>
                  <MenuItem value="">Alle Gruppen</MenuItem>
                  {groups.map((g) => (
                    <MenuItem key={g.id} value={g.id}><Box display="flex" alignItems="center" gap={1}><GroupBadge group={g} size={20} tooltip={false} />{g.name}</Box></MenuItem>
                  ))}
                </TextField>
              )}
              {!isMobile && <Button variant="outlined" startIcon={<Groups />} onClick={() => setGroupManager(true)} sx={{ flexShrink: 0 }}>Gruppen</Button>}
              {canEdit && !isMobile && (
                <Button variant="contained" startIcon={<Add />} onClick={() => open(null, 'data')} sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}>Neuer Kunde</Button>
              )}
            </Stack>
            <Stack direction="row" spacing={1} alignItems="center">
              <FilterChips value={filter} onChange={setFilter} sx={{ flex: 1 }}
                options={FILTERS.map((f) => ({ key: f.key, label: f.label, count: counts[f.key], color: f.key === 'negative' ? 'error' : f.key === 'low' ? 'warning' : 'primary' }))} />
              {!tableLayout && (
                <>
                  <Button size="small" color="inherit" startIcon={<Sort />} onClick={(e) => setSortAnchor(e.currentTarget)} sx={{ flexShrink: 0, color: 'text.secondary' }}>
                    {sortDef.label}
                  </Button>
                  <Menu anchorEl={sortAnchor} open={!!sortAnchor} onClose={() => setSortAnchor(null)}>
                    {SORTS.map((s) => (
                      <MenuItem key={s.key} selected={sort.key === s.key} onClick={() => { setSort({ key: s.key, dir: s.dir }); setSortAnchor(null); }}>
                        <ListItemIcon>{sort.key === s.key ? <Check fontSize="small" /> : null}</ListItemIcon>{s.label}
                      </MenuItem>
                    ))}
                    {isMobile && (
                      <MenuItem onClick={() => { setSortAnchor(null); setGroupManager(true); }} sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
                        <ListItemIcon><Groups fontSize="small" /></ListItemIcon>Gruppen verwalten
                      </MenuItem>
                    )}
                  </Menu>
                </>
              )}
            </Stack>
            {isMobile && groups.length > 0 && (
              <TextField select size="small" label="Gruppe" value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} fullWidth>
                <MenuItem value="">Alle Gruppen</MenuItem>
                {groups.map((g) => <MenuItem key={g.id} value={g.id}>{g.name}</MenuItem>)}
              </TextField>
            )}
          </Stack>
      </StickyToolbar>

      {/* Liste */}
      {isLoading ? (
        <Skeleton variant="rounded" height={400} />
      ) : visible.length === 0 ? (
        <Card sx={{ p: 6, textAlign: 'center' }}>
          <PersonOff sx={{ fontSize: 56, color: 'text.disabled', mb: 1 }} />
          <Typography color="text.secondary">Keine Kunden für diese Suche oder diesen Filter.</Typography>
          {(filter !== 'all' || search || groupFilter) && (
            <Button sx={{ mt: 2 }} onClick={() => { setFilter('all'); setSearch(''); setGroupFilter(''); }}>Alle Kunden zeigen</Button>
          )}
        </Card>
      ) : (
        <Card>
          {tableLayout && (
            <Box sx={{ display: 'grid', gridTemplateColumns: COLS, gap: 2, alignItems: 'center', px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'action.hover' }}>
              <HeaderCell label="Kunde" sortKey="name" sort={sort} onSort={onSort} />
              <HeaderCell label="Guthaben" sortKey="balance" sort={sort} onSort={onSort} align="right" />
              <HeaderCell label="Letzte Aktivität" sortKey="activity" sort={sort} onSort={onSort} />
              <HeaderCell label="Käufe" align="right" sort={sort} />
              <HeaderCell label="Kunde seit" sort={sort} />
              <HeaderCell label="Im Verkauf" align="center" sort={sort} />
              <span />
            </Box>
          )}
          {visible.map((c) => (tableLayout
            ? <TableRow key={c.id} c={c} onOpen={open} onToggle={(x) => toggle.mutate(x)} canEdit={canEdit} />
            : <CompactRow key={c.id} c={c} onOpen={open} />
          ))}
        </Card>
      )}
      {!isLoading && visible.length > 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5, textAlign: 'center' }}>
          {visible.length} von {customers.length} Kunden · Summe {money(visible.reduce((s, c) => s + num(c.balance), 0))}
        </Typography>
      )}

      {canEdit && isMobile && (
        <Fab color="primary" aria-label="Neuer Kunde" onClick={() => open(null, 'data')}
          sx={{ position: 'fixed', right: 16, bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))', boxShadow: `0 8px 24px ${alpha(theme.palette.primary.main, 0.35)}` }}>
          <Add />
        </Fab>
      )}

      <CustomerPanel open={panel.open} customer={panelCustomer} initialTab={panel.tab} groups={groups}
        canEdit={canEdit} canSeeContact={canSeeContact}
        onClose={() => setPanel((p) => ({ ...p, open: false }))}
        onCreated={(c) => setPanel({ open: true, id: c.id, tab: 'account', fallback: c })} />
      <GroupManagerDialog open={groupManager} onClose={() => setGroupManager(false)} />
    </Box>
  );
}
