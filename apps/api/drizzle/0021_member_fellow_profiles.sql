ALTER TABLE `members` ADD `hometown_city_code` char(6);--> statement-breakpoint
ALTER TABLE `members` ADD `industry` varchar(100);--> statement-breakpoint
ALTER TABLE `members` ADD `schools` json;