-- Command Center, Governance → Entities (brief update 2): the entities as the clear-agreements drafting brief
-- names them, and Clear Building Co., the I-06 lender, owned by Holdings and run by its own managers. Clear
-- Properties is owned by Holdings and run by the Manager, as Clear Lending is.
--
-- Each change is made only where the row still says what the structure first wrote, so nothing anyone has
-- changed since is overwritten. Clear Building Co. goes in only where the entities are already there: on an
-- empty database the structure writes them all, with it, after the migrations. Of its facts, only how it's
-- taxed, as the structure keeps for every entity; a formation's steps come when someone records them.

UPDATE command.entities SET name = 'Clear Collective LLC' WHERE id = 'coop' AND name = 'Clear Co-op';
UPDATE command.entities SET kind = 'Wyoming LLC · member-owned' WHERE id = 'coop' AND kind = 'Wyoming LLC · co-op';
UPDATE command.entities SET role = 'The parent. One member, one vote. Taxed as a corporation under Subchapter T, trading as “Clear”.'
  WHERE id = 'coop' AND role = 'The parent. One member, one vote. Taxed as a corporation.';

UPDATE command.entities SET kind = 'Wyoming LLC · was Deed3Labs LLC' WHERE id = 'fin' AND kind = 'Wyoming LLC';
UPDATE command.entities SET role = 'The program entity: cash accounts, cards and money movement with Lithic and Bridge. Trustee of the ESA Reserve Trust, and services Clear Lending’s loans.'
  WHERE id = 'fin' AND role = 'Runs the card and money programs. Holds member funds for their benefit.';

UPDATE command.entities SET role = 'Records and title administration. Holds title as trustee only for Clear and companies it wholly owns, and never holds funds.'
  WHERE id = 'dt' AND role = 'Keeps title records and will review deeds as a validator. Does not hold escrow.';

UPDATE command.entities SET kind = 'Wyoming corp · was StreetBased Inc.' WHERE id = 'hold' AND kind = 'Wyoming C-corp';
UPDATE command.entities SET role = 'Owns the Manager, Clear Lending and Clear Properties. Clear holds Class A, the governance class; Class B is the financial class.'
  WHERE id = 'hold' AND role = 'Holds the economics of both funds. The co-op holds its governance class.';
UPDATE command.entities SET owned = 'Class A' WHERE id = 'hold' AND owned = '100%';

UPDATE command.entities SET kind = 'Wyoming C-corp · was Deed3 Holdings Inc.' WHERE id = 'labs' AND kind = 'Wyoming C-corp';
UPDATE command.entities SET role = 'Research and development. Builds Clear’s apps as work made for hire, and maintains the protocol for the Foundation.'
  WHERE id = 'labs' AND role = 'Research and development. Maintains the protocol for the Foundation.';
UPDATE command.entities SET owned = '56%, fully diluted' WHERE id = 'labs' AND owned = 'Majority';

UPDATE command.entities SET name = 'Clear Capital Management LLC' WHERE id = 'mgr' AND name = 'Manager LLC';
UPDATE command.entities SET role = 'Manages Clear Lending and Clear Properties under M-02 and M-03. Owned by Holdings.'
  WHERE id = 'mgr' AND role = 'Manages both funds. Owned by Holdings.';

UPDATE command.entities SET role = 'Takes §721 property contributions for OP units. Each property sits in its own project LLC.'
  WHERE id = 'prop' AND role = 'Takes property contributions for OP units.';
UPDATE command.entities SET parent_id = 'hold' WHERE id = 'prop' AND parent_id = 'mgr';
UPDATE command.entities SET owned = 'Majority, shrinking as contributors join' WHERE id = 'prop' AND owned IS NULL;

UPDATE command.entities SET role = 'Lender of record for all member credit, under a California Financing Law licence. Runs the Yield Pool and BurnerBonds.'
  WHERE id = 'lend' AND role = 'The credit book, bond series and pool shares.';
UPDATE command.entities SET owned = '100%' WHERE id = 'lend' AND owned IS NULL;
UPDATE command.entities SET facts = jsonb_set(facts, '{steps,4}', '["CFL licence", 0]')
  WHERE id = 'lend' AND facts #> '{steps,4,0}' = '"Bank account"' AND facts #> '{steps,4,1}' = '0';

UPDATE command.entities SET name = 'Deed Protocol Foundation SF' WHERE id = 'fdn' AND name = 'Clear Foundation';
UPDATE command.entities SET kind = 'Wyoming statutory foundation' WHERE id = 'fdn' AND kind = 'Wyoming foundation';
UPDATE command.entities SET role = 'Holds the Deed Protocol. Ownerless, perpetual and outside the tree.'
  WHERE id = 'fdn' AND role = 'Holds the protocol. Ownerless, outside the tree.';

INSERT INTO command.entities (id, position, name, kind, status, role, map_x, map_y, parent_id, owned, under, facts)
SELECT 'lsub', (SELECT max(position) + 1 FROM command.entities), 'Clear Building Co.', 'Wyoming LLC · the I-06 lender', 'planned',
  'The I-06 lender: funds Clear and its project companies to build member homes. “Building Co.” in the agreements. A sister of Clear Lending, run by its own managers, never funded by Clear Lending or by Earn.',
  37, 63.2, 'hold', '100%, once I-06 funds', 'Holdings 100%',
  '{"tax":"Disregarded"}'::jsonb
WHERE EXISTS (SELECT 1 FROM command.entities WHERE id = 'hold') AND NOT EXISTS (SELECT 1 FROM command.entities WHERE id = 'lsub');
