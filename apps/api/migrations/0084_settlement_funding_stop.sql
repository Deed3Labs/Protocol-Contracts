-- Card settlement (decision 54, the redesign): a person can stop the funding desk from Command. A stop is
-- a move of its own, kind 'stop', recorded failed so the desk halts on it exactly as on any failed move
-- (nothing moves until it is cleared), with who stopped it and why. It moves no money: amount 0.
ALTER TABLE ops.settlement_funding_moves DROP CONSTRAINT IF EXISTS settlement_funding_moves_kind_check;
ALTER TABLE ops.settlement_funding_moves
  ADD CONSTRAINT settlement_funding_moves_kind_check CHECK (kind IN ('book', 'deploy', 'return-margin', 'return-pool', 'margin-advance', 'stop'));
ALTER TABLE ops.settlement_funding_moves DROP CONSTRAINT IF EXISTS settlement_funding_moves_amount_check;
ALTER TABLE ops.settlement_funding_moves
  ADD CONSTRAINT settlement_funding_moves_amount_check CHECK (amount > 0 OR (kind = 'stop' AND amount = 0));
