ALTER TABLE "venues" ADD COLUMN "location_disclosure" varchar(10) DEFAULT 'staged' NOT NULL;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "neighbours" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
-- Existing service venues predate the choice, so they get the safe answer
-- rather than the column default. Most service providers in this market work
-- from home; publishing a pin for one because a migration defaulted to the
-- chalet rule is not a setting anyone would have opted into. They can widen it
-- themselves from the console.
UPDATE "venues" SET "location_disclosure" = 'area' WHERE "type" = 'service';
