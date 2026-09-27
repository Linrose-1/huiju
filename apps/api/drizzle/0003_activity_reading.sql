CREATE TABLE `reading_events` (
	`id` char(36) NOT NULL,
	`visitor_hash` char(64) NOT NULL,
	`activity_id` char(36) NOT NULL,
	`recorded_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `reading_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reading_visitors` (
	`visitor_hash` char(64) NOT NULL,
	`member_id` char(36),
	CONSTRAINT `reading_visitors_visitor_hash` PRIMARY KEY(`visitor_hash`)
);
--> statement-breakpoint
ALTER TABLE `reading_events` ADD CONSTRAINT `reading_events_visitor_hash_reading_visitors_visitor_hash_fk` FOREIGN KEY (`visitor_hash`) REFERENCES `reading_visitors`(`visitor_hash`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `reading_events` ADD CONSTRAINT `reading_events_activity_id_activities_id_fk` FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `reading_visitors` ADD CONSTRAINT `reading_visitors_member_id_members_id_fk` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX `reading_events_activity_visitor_idx` ON `reading_events` (`activity_id`,`visitor_hash`);--> statement-breakpoint
CREATE INDEX `reading_events_visitor_idx` ON `reading_events` (`visitor_hash`);--> statement-breakpoint
CREATE INDEX `reading_visitors_member_idx` ON `reading_visitors` (`member_id`);