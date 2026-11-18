-- Command Center, Money (brief update 2, section 5): Where it sits brackets Clear Lending's accounts apart, a
-- separate company that lends to members: CL Operating, the Credit Settlement Account, the CL Loss Reserve and
-- the CL Fees wallet. Their group is `cl`. The accounts themselves are the structure's (structure.ts), added on
-- start to a list that's already there, as BondVault was.
ALTER TABLE command.accounts DROP CONSTRAINT IF EXISTS accounts_owner_group_check;
ALTER TABLE command.accounts ADD CONSTRAINT accounts_owner_group_check CHECK (owner_group IN ('members', 'set', 'coop', 'cl'));
