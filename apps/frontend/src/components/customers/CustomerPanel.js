/**
 * Kunde in einer Seitenleiste (ab sm) bzw. im Vollbild (Handy).
 * Reiter „Konto“: Guthaben, Aufladen, Kennzahlen, vollständiger Kontoverlauf (Käufe, Aufladungen, Übernahme).
 * Reiter „Daten“: Stammdaten, Gruppe, Kontaktdaten. Neuer Kunde: nur „Daten“.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Avatar, Box, Button, Chip, CircularProgress, Drawer, IconButton, MenuItem, Stack, Switch,
  Tab, Tabs, TextField, Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  AccountBalance, Add, Close, Edit, Inventory2Outlined, LocalAtm, ReceiptLong, SettingsBackupRestore, SwapHoriz, Undo,
} from '@mui/icons-material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import { API_ENDPOINTS } from '../../config/api';
import { invalidate } from '../../utils/invalidate';
import { money, num } from '../../utils/format';
import GroupBadge from './GroupBadge';
import TopUpDialog from './TopUpDialog';

export const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
const dateTime = (d) => new Date(d).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const emptyForm = {
  name: '', nickname: '', gender: 'OTHER', active: true, groupId: '', isGroupAccount: false,
  company: '', street: '', zip: '', city: '', phone: '', email: '',
};
const fromCustomer = (c) => Object.fromEntries(Object.keys(emptyForm).map((k) => [k,
  k === 'active' ? c.active !== false : k === 'isGroupAccount' ? !!c.isGroupAccount : k === 'gender' ? c.gender || 'OTHER' : c[k] ?? '']));

/* ------------------------------ Verlauf ------------------------------ */

const TOPUP_LABEL = { CASH: 'Aufladung bar', TRANSFER: 'Aufladung Überweisung', REIMBURSEMENT: 'Auslage (Einkauf)', MIGRATION: 'Übernahme Clubtouch 2.0' };
const TOPUP_ICON = { CASH: LocalAtm, TRANSFER: AccountBalance, REIMBURSEMENT: ReceiptLong, MIGRATION: SettingsBackupRestore };

function HistoryRow({ entry: e }) {
  let Icon; let title; let sub; let color = 'text.primary'; let strike = false;
  if (e.type === 'TOPUP') {
    const storno = (e.reference || '').startsWith('STORNO:');
    Icon = storno ? Undo : TOPUP_ICON[e.method] || LocalAtm;
    title = storno ? 'Storno einer Aufladung' : TOPUP_LABEL[e.method] || 'Aufladung';
    sub = storno || e.method === 'MIGRATION' ? null : e.reference;
    if (!storno && e.method === 'MIGRATION' && e.reference) sub = e.reference.replace(/^Übernahme Clubtouch 2\.0 /, 'Altsystem ');
    color = e.amount >= 0 ? 'success.main' : 'error.main';
  } else if (e.txType === 'REFUND') {
    // Gegenbuchung eines stornierten Kaufs: Betrag geht zurück aufs Konto
    Icon = Undo;
    const names = (e.items || []).map((i) => i.article?.name).filter(Boolean);
    title = `Storno${names.length ? `: ${names.slice(0, 2).join(', ')}${names.length > 2 ? ' …' : ''}` : ''}`;
    color = 'success.main';
  } else {
    Icon = ReceiptLong;
    const items = (e.items || []).map((i) => `${num(i.quantity)}× ${i.article?.name || 'Artikel'}`);
    title = items.length ? items.slice(0, 3).join(', ') + (items.length > 3 ? ` +${items.length - 3}` : '') : 'Einkauf';
    sub = e.cancelled ? 'storniert' : e.method === 'CASH' ? 'bar bezahlt – Guthaben unverändert' : null;
    strike = e.cancelled;
    color = e.cancelled || e.method === 'CASH' ? 'text.secondary' : 'text.primary';
  }
  const shown = e.type === 'TOPUP' ? e.amount : e.txType === 'REFUND' ? Math.abs(e.amount) : -(e.originalAmount ?? Math.abs(e.amount));
  return (
    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ py: 1.25, borderBottom: '1px solid', borderColor: 'divider', '&:last-of-type': { borderBottom: 'none' } }}>
      <Avatar sx={{ width: 36, height: 36, bgcolor: 'action.hover', color: 'text.secondary' }}><Icon fontSize="small" /></Avatar>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography fontWeight={600} noWrap sx={{ textDecoration: strike ? 'line-through' : 'none', opacity: strike ? 0.6 : 1 }}>{title}</Typography>
        <Typography variant="body2" color="text.secondary" noWrap>{dateTime(e.date)}{sub ? ` · ${sub}` : ''}</Typography>
      </Box>
      <Typography fontWeight={800} sx={{ color, whiteSpace: 'nowrap', textDecoration: strike ? 'line-through' : 'none' }}>
        {shown > 0 ? '+' : shown < 0 ? '−' : ''}{money(Math.abs(shown))}
      </Typography>
    </Stack>
  );
}

function AccountTab({ customer, canEdit, onTopUp }) {
  const { data: stats } = useQuery({
    queryKey: ['customer-stats', customer.id],
    queryFn: async () => (await api.get(`${API_ENDPOINTS.CUSTOMERS}/${customer.id}/stats`)).data,
  });
  const { data: history, isLoading } = useQuery({
    queryKey: ['customer-history', customer.id],
    queryFn: async () => (await api.get(`${API_ENDPOINTS.CUSTOMERS}/${customer.id}/history`, { params: { limit: 200 } })).data,
  });
  const balance = num(customer.balance);
  const kpi = (label, value) => (
    <Box sx={{ flex: 1, minWidth: 0, p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
      <Typography variant="caption" color="text.secondary" noWrap display="block">{label}</Typography>
      <Typography fontWeight={800} noWrap>{value}</Typography>
    </Box>
  );
  return (
    <Stack spacing={2}>
      <Box sx={{ p: 2.5, borderRadius: 3, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
        <Typography variant="body2" color="text.secondary">Guthaben</Typography>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
          <Typography variant="h3" sx={{ fontWeight: 800, color: balance < 0 ? 'error.main' : 'text.primary', fontSize: { xs: '2.25rem', sm: '2.75rem' } }}>{money(balance)}</Typography>
          {canEdit && <Button variant="contained" size="large" startIcon={<Add />} onClick={onTopUp}>Aufladen</Button>}
        </Stack>
      </Box>
      <Stack direction="row" spacing={1.5}>
        {kpi('Ausgegeben', stats ? money(stats.totalSpent) : '…')}
        {kpi('Käufe', stats ? stats.transactionCount : '…')}
        {kpi('Ø pro Kauf', stats ? money(stats.transactionCount ? num(stats.totalSpent) / stats.transactionCount : 0) : '…')}
      </Stack>
      {stats?.favoriteArticles?.length > 0 && (
        <Box>
          <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 800 }}>Lieblingsartikel</Typography>
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, mt: 0.5 }}>
            {stats.favoriteArticles.slice(0, 5).map((a) => <Chip key={a.id} label={`${a.name} · ${num(a.total_quantity)}×`} variant="outlined" />)}
          </Stack>
        </Box>
      )}
      <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 3, px: 2, bgcolor: 'background.paper' }}>
        <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 800, display: 'block', pt: 1.5 }}>Kontoverlauf</Typography>
        {isLoading ? (
          <Box sx={{ py: 3, textAlign: 'center' }}><CircularProgress size={24} /></Box>
        ) : history?.length ? (
          history.map((e) => <HistoryRow key={`${e.type}-${e.id}`} entry={e} />)
        ) : (
          <Stack alignItems="center" sx={{ py: 4, color: 'text.secondary' }}>
            <Inventory2Outlined sx={{ fontSize: 40, mb: 1 }} />
            <Typography>Noch keine Buchungen</Typography>
          </Stack>
        )}
      </Box>
    </Stack>
  );
}

/* ------------------------------- Daten ------------------------------- */

function DataTab({ form, set, groups, canSeeContact, readOnly, error }) {
  return (
    <Stack spacing={2}>
      <Box sx={{ p: 2.5, borderRadius: 3, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
        <Stack spacing={2}>
          <TextField label="Name" value={form.name} onChange={(e) => set({ name: e.target.value })} disabled={readOnly}
            error={!!error.name} helperText={error.name} autoFocus={!form.name} />
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
            <TextField label="Spitzname (optional)" value={form.nickname} onChange={(e) => set({ nickname: e.target.value })} disabled={readOnly}
              helperText="Wird im Verkauf statt des Namens angezeigt" />
            <TextField select label="Geschlecht" value={form.gender} onChange={(e) => set({ gender: e.target.value })} disabled={readOnly}>
              <MenuItem value="FEMALE">Weiblich</MenuItem>
              <MenuItem value="MALE">Männlich</MenuItem>
              <MenuItem value="OTHER">Divers / nicht angegeben</MenuItem>
            </TextField>
          </Box>
          <Stack direction="row" alignItems="center" spacing={2} component="label">
            <Box sx={{ flex: 1 }}>
              <Typography fontWeight={600}>Im Verkauf anzeigen</Typography>
              <Typography variant="body2" color="text.secondary">Ausgeblendete Kunden behalten ihr Guthaben.</Typography>
            </Box>
            <Switch checked={form.active} onChange={(e) => set({ active: e.target.checked })} disabled={readOnly} />
          </Stack>
        </Stack>
      </Box>

      <Box sx={{ p: 2.5, borderRadius: 3, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
        <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 800 }}>Team / Gruppe</Typography>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField select label="Gruppe" value={form.groupId} onChange={(e) => set({ groupId: e.target.value })} disabled={readOnly}
            SelectProps={{ displayEmpty: true }} InputLabelProps={{ shrink: true }}>
            <MenuItem value="">– keine –</MenuItem>
            {groups.map((g) => (
              <MenuItem key={g.id} value={g.id}>
                <Box display="flex" alignItems="center" gap={1}><GroupBadge group={g} size={20} tooltip={false} />{g.name}</Box>
              </MenuItem>
            ))}
          </TextField>
          <Stack direction="row" alignItems="center" spacing={2} component="label">
            <Box sx={{ flex: 1 }}>
              <Typography fontWeight={600}>Gruppenkonto</Typography>
              <Typography variant="body2" color="text.secondary">Mehrere buchen auf dieses Konto. Zählt in der Team-Wertung, aber nicht als Kopf bei „pro Kopf“.</Typography>
            </Box>
            <Switch checked={form.isGroupAccount} onChange={(e) => set({ isGroupAccount: e.target.checked })} disabled={readOnly} />
          </Stack>
        </Stack>
      </Box>

      {canSeeContact && (
        <Box sx={{ p: 2.5, borderRadius: 3, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
          <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 800 }}>Kontaktdaten (optional)</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 2fr' }, gap: 2, mt: 1 }}>
            <TextField label="Telefon" type="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} disabled={readOnly} sx={{ gridColumn: { sm: '1 / 2' } }} />
            <TextField label="E-Mail" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} disabled={readOnly} />
            <TextField label="Firma / Anschriftzusatz" value={form.company} onChange={(e) => set({ company: e.target.value })} disabled={readOnly} sx={{ gridColumn: '1 / -1' }} />
            <TextField label="Straße" value={form.street} onChange={(e) => set({ street: e.target.value })} disabled={readOnly} sx={{ gridColumn: '1 / -1' }} />
            <TextField label="PLZ" value={form.zip} onChange={(e) => set({ zip: e.target.value })} disabled={readOnly} />
            <TextField label="Ort" value={form.city} onChange={(e) => set({ city: e.target.value })} disabled={readOnly} />
          </Box>
        </Box>
      )}
    </Stack>
  );
}

/* -------------------------------- Panel ------------------------------ */

/**
 * @param {{ open, customer?, initialTab?: 'account'|'data', groups, canEdit, canSeeContact, onClose, onCreated? }} props
 */
export default function CustomerPanel({ open, customer, initialTab = 'account', groups, canEdit, canSeeContact, onClose, onCreated }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const queryClient = useQueryClient();
  const isNew = !customer;
  const [tab, setTab] = useState(initialTab);
  const [form, setForm] = useState(emptyForm);
  const [touched, setTouched] = useState(false);
  const [topUpOpen, setTopUpOpen] = useState(false);

  // Kontaktdaten kommen nur aus der Einzelabfrage
  const { data: details } = useQuery({
    queryKey: ['customer', customer?.id],
    queryFn: async () => (await api.get(`${API_ENDPOINTS.CUSTOMERS}/${customer.id}`)).data.customer,
    enabled: open && !!customer,
  });

  const customerId = customer?.id;
  useEffect(() => {
    if (!open) return;
    setTab(isNew ? 'data' : initialTab);
    setForm(customer ? fromCustomer(customer) : emptyForm);
    setTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customerId, initialTab]);
  // Kontaktdaten nachtragen, sobald geladen (ohne Eingaben zu überschreiben)
  useEffect(() => {
    if (!details) return;
    setForm((f) => ({ ...f, ...Object.fromEntries(['company', 'street', 'zip', 'city', 'phone', 'email'].map((k) => [k, f[k] || details[k] || ''])) }));
  }, [details]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const errors = useMemo(() => ({ name: form.name.trim().length < 2 ? 'Mindestens 2 Zeichen' : null }), [form.name]);
  const valid = !errors.name;

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(), nickname: form.nickname.trim(), gender: form.gender, active: form.active,
        groupId: form.groupId || null, isGroupAccount: form.isGroupAccount,
        ...(canSeeContact ? Object.fromEntries(['company', 'street', 'zip', 'city', 'phone', 'email'].map((k) => [k, form[k].trim()])) : {}),
      };
      if (isNew) return (await api.post(API_ENDPOINTS.CUSTOMERS, payload)).data;
      return (await api.put(`${API_ENDPOINTS.CUSTOMERS}/${customer.id}`, payload)).data;
    },
    onSuccess: (data) => {
      invalidate(queryClient, 'customers', 'finance');
      if (isNew && data?.customer) onCreated?.(data.customer); // direkt zum neuen Konto, z. B. zum Aufladen
      else onClose();
    },
  });

  const current = customer;
  const balance = num(current?.balance);

  return (
    <Drawer anchor="right" open={open} onClose={onClose} sx={{ zIndex: (t) => t.zIndex.modal }}
      PaperProps={{
        component: 'form', noValidate: true,
        onSubmit: (e) => {
          e.preventDefault();
          if (!(isNew || tab === 'data')) return; // gespeichert wird nur im Reiter „Daten“
          setTouched(true);
          if (valid && canEdit) save.mutate();
        },
        sx: { width: fullScreen ? '100%' : 560, maxWidth: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'background.default', borderRadius: 0 },
      }}>
      {/* Kopf */}
      <Box sx={{ bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider', pt: { xs: 'calc(8px + env(safe-area-inset-top, 0px))', sm: 1 } }}>
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ px: { xs: 1, sm: 2 }, pb: isNew ? 1.5 : 0 }}>
          <IconButton onClick={onClose} aria-label="Schließen"><Close /></IconButton>
          {!isNew && <Avatar sx={{ bgcolor: 'primary.main', color: 'primary.contrastText', fontWeight: 800 }}>{initials(current.name)}</Avatar>}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
              <Typography variant="h6" noWrap sx={{ lineHeight: 1.2 }}>{isNew ? 'Neuer Kunde' : current.name}</Typography>
              {!isNew && current.group && <GroupBadge group={current.group} size={22} />}
            </Stack>
            {!isNew && (
              <Typography variant="body2" color="text.secondary" noWrap>
                {[current.nickname && `„${current.nickname}“`, current.active === false && 'ausgeblendet', `Kunde seit ${new Date(current.createdAt).toLocaleDateString('de-DE')}`].filter(Boolean).join(' · ')}
              </Typography>
            )}
          </Box>
          {!isNew && <Typography variant="h6" sx={{ color: balance < 0 ? 'error.main' : 'primary.main', whiteSpace: 'nowrap', display: { xs: 'none', sm: 'block' } }}>{money(balance)}</Typography>}
        </Stack>
        {!isNew && (
          <Tabs value={tab} onChange={(e, v) => setTab(v)} variant="fullWidth" sx={{ minHeight: 44, '& .MuiTab-root': { minHeight: 44, fontWeight: 700 } }}>
            <Tab value="account" label="Konto" icon={<SwapHoriz fontSize="small" />} iconPosition="start" />
            <Tab value="data" label="Daten" icon={<Edit fontSize="small" />} iconPosition="start" />
          </Tabs>
        )}
      </Box>

      {/* Inhalt */}
      <Box sx={{ flex: 1, overflowY: 'auto', p: { xs: 1.5, sm: 2 } }}>
        {tab === 'account' && !isNew ? (
          <AccountTab customer={current} canEdit={canEdit} onTopUp={() => setTopUpOpen(true)} />
        ) : (
          <>
            <DataTab form={form} set={set} groups={groups} canSeeContact={canSeeContact} readOnly={!canEdit} error={touched ? errors : {}} />
            {save.isError && (
              <Alert severity="error" sx={{ mt: 2 }}>{save.error?.response?.data?.error || save.error?.response?.data?.errors?.[0]?.msg || 'Speichern fehlgeschlagen'}</Alert>
            )}
          </>
        )}
      </Box>

      {/* Aktionen (nur Daten) */}
      {(tab === 'data' || isNew) && canEdit && (
        <Stack direction="row" spacing={1.5} justifyContent="flex-end"
          sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', pb: { xs: 'calc(16px + env(safe-area-inset-bottom, 0px))', sm: 2 } }}>
          <Button color="inherit" onClick={onClose}>Abbrechen</Button>
          <Button type="submit" variant="contained" size="large" disabled={save.isPending} sx={{ px: 4, flex: { xs: 1, sm: 'none' } }}>
            {save.isPending ? 'Speichert…' : isNew ? 'Anlegen' : 'Speichern'}
          </Button>
        </Stack>
      )}

      {!isNew && <TopUpDialog customer={current} open={topUpOpen} onClose={() => setTopUpOpen(false)} />}
    </Drawer>
  );
}
