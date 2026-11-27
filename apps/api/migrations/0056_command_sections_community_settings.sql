-- Command Center, the redesign (docs/ui-redesign-plan.md): two new sections, Community and Settings,
-- each with its own level. Until someone sets them, a group (and anyone with custom access) gets the
-- level it already had for the section each came from: Community Governance's, Settings Team's
-- (access). Nothing is renamed: Build keeps `contracts`, Team keeps `access`.

UPDATE command.groups
SET levels = levels || jsonb_build_object('community', levels -> 'governance', 'settings', levels -> 'access')
WHERE NOT levels ? 'community' OR NOT levels ? 'settings';

UPDATE command.person_access
SET custom_levels = custom_levels || jsonb_build_object('community', custom_levels -> 'governance', 'settings', custom_levels -> 'access')
WHERE custom_levels IS NOT NULL AND (NOT custom_levels ? 'community' OR NOT custom_levels ? 'settings');

-- an access change still waiting for a second person carries a full set of levels: it gets them too,
-- so approving it after this still applies a valid set
UPDATE command.proposals
SET payload = jsonb_set(payload, '{levels}', (payload -> 'levels') || jsonb_build_object('community', payload -> 'levels' -> 'governance', 'settings', payload -> 'levels' -> 'access'))
WHERE status = 'waiting' AND jsonb_typeof(payload -> 'levels') = 'object' AND payload -> 'levels' ? 'governance';

UPDATE command.proposals
SET payload = jsonb_set(payload, '{custom}', (payload -> 'custom') || jsonb_build_object('community', payload -> 'custom' -> 'governance', 'settings', payload -> 'custom' -> 'access'))
WHERE status = 'waiting' AND jsonb_typeof(payload -> 'custom') = 'object' AND payload -> 'custom' ? 'governance';
