-- Card settlement (decision 54, the redesign): the Credit Settlement Account is funded before each daily card cut-off
-- (what is due plus the buffer), not kept at a peak-day forecast. Words only; structureCommand inserts and never updates.
UPDATE command.accounts SET purpose = 'At the Bank Partner · funded before each daily card cut-off' WHERE id = 'clset';
