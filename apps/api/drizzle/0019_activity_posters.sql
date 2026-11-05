CREATE TABLE `activity_poster_copies` (
	`activity_id` char(36) NOT NULL,
	`subtitle` varchar(40) NOT NULL,
	`highlights` json NOT NULL,
	`source_hash` char(64) NOT NULL,
	`version` int unsigned NOT NULL,
	`confirmed_by` char(36) NOT NULL,
	`confirmed_at` datetime(3) NOT NULL,
	CONSTRAINT `activity_poster_copies_activity_id` PRIMARY KEY(`activity_id`)
);
--> statement-breakpoint
CREATE TABLE `activity_poster_shares` (
	`scene` varchar(25) NOT NULL,
	`activity_id` char(36) NOT NULL,
	`member_id` char(36) NOT NULL,
	`invite_code` varchar(32) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `activity_poster_shares_scene` PRIMARY KEY(`scene`),
	CONSTRAINT `activity_poster_shares_activity_member_uq` UNIQUE(`activity_id`,`member_id`)
);
--> statement-breakpoint
CREATE TABLE `ai_poster_reservations` (
	`member_id` char(36) NOT NULL,
	`reservation_id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	CONSTRAINT `ai_poster_reservations_member_id` PRIMARY KEY(`member_id`)
);
--> statement-breakpoint
CREATE TABLE `ai_poster_usages` (
	`id` char(36) NOT NULL,
	`member_id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `ai_poster_usages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `activity_poster_copies` ADD CONSTRAINT `activity_poster_copies_activity_id_activities_id_fk` FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `activity_poster_copies` ADD CONSTRAINT `activity_poster_copies_confirmed_by_members_id_fk` FOREIGN KEY (`confirmed_by`) REFERENCES `members`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `activity_poster_shares` ADD CONSTRAINT `activity_poster_shares_activity_id_activities_id_fk` FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `activity_poster_shares` ADD CONSTRAINT `activity_poster_shares_member_id_members_id_fk` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ai_poster_reservations` ADD CONSTRAINT `ai_poster_reservations_member_id_members_id_fk` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ai_poster_usages` ADD CONSTRAINT `ai_poster_usages_member_id_members_id_fk` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ai_poster_usages_member_created_idx` ON `ai_poster_usages` (`member_id`,`created_at`);