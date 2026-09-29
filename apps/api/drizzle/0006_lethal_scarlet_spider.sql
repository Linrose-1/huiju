CREATE TABLE `ai_activity_draft_usages` (
	`id` char(36) NOT NULL,
	`member_id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `ai_activity_draft_usages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `ai_activity_draft_usages` ADD CONSTRAINT `ai_activity_draft_usages_member_id_members_id_fk` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX `ai_activity_draft_usages_member_created_idx` ON `ai_activity_draft_usages` (`member_id`,`created_at`);