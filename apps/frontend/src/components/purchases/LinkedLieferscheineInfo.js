import React from "react";
import { Alert, AlertTitle, List, ListItem, ListItemText, Typography } from "@mui/material";
import { LocalShipping } from "@mui/icons-material";
import { summarizeItems, lieferscheinLabel } from "../../utils/purchaseDocs";

/**
 * Erklärt auf einer Rechnung, dass der Wareneingang der zugeordneten Lieferscheine
 * bereits gebucht ist. Regel im Backend: Lieferschein UND Rechnungspositionen erhöhen
 * jeweils den Bestand; das Zuordnen selbst ändert nichts. Wer also einen Lieferschein
 * zuordnet, darf die gleichen Artikel nicht noch einmal als Position erfassen.
 *
 * Props: lieferscheine [{ documentNumber, documentDate, items? }], ownLineCount (Positionen auf der Rechnung)
 */
export default function LinkedLieferscheineInfo({ lieferscheine = [], ownLineCount = 0 }) {
  const list = (lieferscheine || []).filter(Boolean);
  if (list.length === 0) return null;

  const n = list.length;
  const total = summarizeItems(list.flatMap((ls) => ls.items || []));
  const doubleRisk = ownLineCount > 0;

  return (
    <Alert
      severity={doubleRisk ? "warning" : "info"}
      icon={<LocalShipping fontSize="inherit" />}
      sx={{ "& .MuiAlert-message": { width: "100%", minWidth: 0 } }}
    >
      <AlertTitle sx={{ fontWeight: 700 }}>
        Wareneingang bereits gebucht ({n === 1 ? "1 Lieferschein" : `${n} Lieferscheine`})
      </AlertTitle>
      <Typography variant="body2">
        {n === 1 ? "Dieser Lieferschein hat" : "Diese Lieferscheine haben"} den Bestand schon erhöht
        {total ? ` (${total})` : ""}. Die Rechnung übernimmt nur Betrag und Zahlung. Die gleichen Artikel hier
        bitte nicht noch einmal als Position erfassen, sonst zählt der Bestand doppelt.
      </Typography>
      <List dense disablePadding sx={{ mt: 0.5 }}>
        {list.map((ls) => (
          <ListItem key={ls.id || ls.documentNumber} disableGutters sx={{ py: 0 }}>
            <ListItemText
              primaryTypographyProps={{ variant: "body2", fontWeight: 600 }}
              secondaryTypographyProps={{ variant: "caption" }}
              primary={lieferscheinLabel(ls)}
              secondary={ls.items ? (summarizeItems(ls.items) || "keine Positionen gebucht") : null}
            />
          </ListItem>
        ))}
      </List>
      {doubleRisk && (
        <Typography variant="body2" fontWeight={700} sx={{ mt: 0.5 }}>
          Achtung: Auf dieser Rechnung {ownLineCount === 1 ? "ist zusätzlich 1 Position" : `sind zusätzlich ${ownLineCount} Positionen`} erfasst.
          Sie erhöhen den Bestand ein zweites Mal. Das ist nur richtig, wenn diese Artikel nicht auf den Lieferscheinen stehen.
        </Typography>
      )}
    </Alert>
  );
}
