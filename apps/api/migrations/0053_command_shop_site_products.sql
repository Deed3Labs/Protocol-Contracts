-- Command Center: Command's record of a product the site sells. Live, with no seed, Command has no
-- record of any product until someone acts on one (a recipe, a run, the shelf): its record is then
-- made from the site's catalog (services/command/sections.ts, adoptSiteProduct). Its costs aren't
-- known yet, so a product's four cost boxes can now be empty: the page says "Not entered yet"
-- rather than a $0 cost and a 100% margin, until a recipe or the boxes give it one.
ALTER TABLE command.shop_products DROP CONSTRAINT shop_products_cost;
