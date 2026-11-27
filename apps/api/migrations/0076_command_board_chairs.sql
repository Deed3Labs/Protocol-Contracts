-- Command Center, Governance: every board has a chair, its first seat. Holdings' was marked one; the Co-op and
-- ClearLabs boards' first seats were marked by how they're filled instead. They become the chair, and the note
-- keeps how the seat is filled, as Holdings' chair says "Elected directly".
UPDATE command.board_seats SET class = 'c', note = coalesce(note, 'Member-elected') WHERE board = 'Co-op board' AND position = 0 AND class = 'm';
UPDATE command.board_seats SET class = 'c', note = coalesce(note, 'Co-op reserved') WHERE board = 'ClearLabs board' AND position = 0 AND class = 'r';
