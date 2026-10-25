-- BondVault is the co-op's capital to use (the Safe takes its deployable excess for operations,
-- growth or the pools), owed back to bondholders at maturity: it belongs with the co-op's money,
-- not with what's set aside. Only the row the structure wrote at start-up, if it's there.
UPDATE command.accounts
   SET owner_group = 'coop',
       purpose = 'Bond buyers’ money · the co-op’s to use, paid back at maturity'
 WHERE id = 'bond';
